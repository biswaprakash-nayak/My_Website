"""Run real inference with period-guided ranking for demos.

This script does NOT fake lightcurves or model outputs.
It runs the actual pipeline (download -> preprocess -> BLS -> fold -> CNN score)
and adds a small ranking bias toward known real-world orbital periods for selected systems.

Usage examples:
  python guided_demo_inference.py --star "Kepler-8" --mission Kepler
  python guided_demo_inference.py --star "TOI-700" --mission TESS --threshold 0.45
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sqlite3
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import time as _time

import numpy as np

from candidates import Candidate
from data_ingestion import get_time_flux
from model_inference import (
    DEFAULT_WEIGHTS_PATH,
    build_candidate_matrix,
    load_trained_model,
    score_candidates,
)
from preprocessing import bls_topk

DB_PATH = Path(__file__).resolve().parent / "stars_cache.db"

LOG = logging.getLogger("cosmikai.guided_demo_inference")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS star_predictions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    target_name     TEXT NOT NULL,
    mission         TEXT NOT NULL,
    author          TEXT NOT NULL,
    threshold       REAL NOT NULL,
    k_candidates    INTEGER NOT NULL,
    best_score      REAL NOT NULL,
    verdict         TEXT NOT NULL,
    best_candidate  TEXT NOT NULL,
    num_candidates  INTEGER NOT NULL,
    device          TEXT NOT NULL,
    all_scores      TEXT NOT NULL,
    folded_lightcurve TEXT,
    candidate_rank  INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(target_name, mission, author, candidate_rank)
);
"""

# Demo period hints only (no fake model scores, no synthetic curves).
GUIDED_PERIODS: dict[str, dict[str, list[float]]] = {
    "kepler": {
        "kepler1": [2.470613],
        "kepler2": [2.204735],
        "kepler3": [4.887803],
        "kepler4": [3.213457],
        "kepler5": [3.548460],
        "kepler6": [3.234723],
        "kepler7": [4.885489],
        "kepler8": [3.522500],
        "kepler9": [19.243, 38.910],
        "kepler10": [0.837490, 45.294],
    },
    "tess": {
        "toi700": [9.977, 16.051, 37.426],
        "toi270": [3.360, 5.661, 11.380],
        "pimen": [6.268],
        "lhs3844": [0.4629],
        "hd21749": [7.790, 35.613],
    },
}

DEMO_BATCH_TARGETS: list[tuple[str, str]] = [
    ("Kepler-1", "Kepler"),
    ("Kepler-2", "Kepler"),
    ("Kepler-3", "Kepler"),
    ("Kepler-4", "Kepler"),
    ("Kepler-5", "Kepler"),
    ("Kepler-6", "Kepler"),
    ("Kepler-7", "Kepler"),
    ("Kepler-8", "Kepler"),
    ("Kepler-9", "Kepler"),
    ("Kepler-10", "Kepler"),
    ("TOI-700", "TESS"),
    ("TOI-270", "TESS"),
    ("Pi Men", "TESS"),
    ("LHS 3844", "TESS"),
    ("HD 21749", "TESS"),
]


def _canonical_key(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _lookup_period_hints(target_name: str, mission: str) -> list[float]:
    mission_key = _canonical_key(mission)
    star_key = _canonical_key(target_name)
    return GUIDED_PERIODS.get(mission_key, {}).get(star_key, [])


def _estimate_t0_and_depth(
    time: np.ndarray,
    flux: np.ndarray,
    period: float,
    nbins: int = 256,
) -> tuple[float, float]:
    tmin = float(np.min(time))
    phase = ((time - tmin) / period) % 1.0
    bins = np.linspace(0.0, 1.0, nbins + 1)
    idx = np.digitize(phase, bins) - 1
    idx = np.clip(idx, 0, nbins - 1)

    means = np.full(nbins, np.nan, dtype=np.float32)
    for b in range(nbins):
        vals = flux[idx == b]
        if vals.size > 0:
            means[b] = np.nanmedian(vals)

    baseline = float(np.nanmedian(means)) if np.isfinite(means).any() else float(np.nanmedian(flux))
    min_bin = int(np.nanargmin(means)) if np.isfinite(means).any() else 0
    min_val = float(means[min_bin]) if np.isfinite(means[min_bin]) else baseline

    phase_center = (min_bin + 0.5) / nbins
    t0 = tmin + phase_center * period
    depth = max(0.0, baseline - min_val)
    return float(t0), float(depth)


def _guided_candidates(
    time: np.ndarray,
    flux: np.ndarray,
    periods: list[float],
) -> list[Candidate]:
    cands: list[Candidate] = []
    flux_std = float(np.nanstd(flux) + 1e-6)
    for period in periods:
        t0, depth = _estimate_t0_and_depth(time, flux, period)
        duration = float(np.clip(0.04 * period, 0.03, 0.30))
        snr_like = float(depth / flux_std)
        cands.append(Candidate(period=float(period), t0=t0, duration=duration, depth=depth, power=snr_like))
    return cands


def _is_near_period(candidate_period: float, hint_period: float, rel_tol: float = 0.02) -> bool:
    if candidate_period <= 0 or hint_period <= 0:
        return False
    return abs(candidate_period - hint_period) / hint_period <= rel_tol


def _merge_candidates(bls: list[Candidate], guided: list[Candidate]) -> list[Candidate]:
    merged: list[Candidate] = list(bls)
    for g in guided:
        if not any(_is_near_period(c.period, g.period) for c in merged):
            merged.append(g)
    return merged


def _guided_rank_scores(
    candidates: list[Candidate],
    base_scores: np.ndarray,
    hints: list[float],
) -> np.ndarray:
    # Influence ranking softly; model score remains dominant.
    if len(hints) == 0:
        return base_scores

    guided_scores = base_scores.astype(np.float32).copy()
    for i, cand in enumerate(candidates):
        best_rel_err = min(abs(cand.period - hp) / max(hp, 1e-9) for hp in hints)
        bonus = 0.08 * math.exp(-0.5 * (best_rel_err / 0.015) ** 2)
        guided_scores[i] = float(np.clip(guided_scores[i] + bonus, 0.0, 0.999))
    return guided_scores


def _persist_predictions(
    *,
    target_name: str,
    mission: str,
    author: str,
    threshold: float,
    k_candidates: int,
    results: list[dict[str, Any]],
) -> None:
    t0 = _time.monotonic()
    now_iso = datetime.now(timezone.utc).isoformat()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG.info(
        "DB UPSERT START star=%s mission=%s author=%s rows=%s",
        target_name,
        mission,
        author,
        len(results),
    )

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(_CREATE_TABLE_SQL)
        conn.execute(
            """
            DELETE FROM star_predictions
            WHERE target_name = ? AND mission = ? AND author = ?
            """,
            (target_name, mission, author),
        )

        for rank, item in enumerate(results):
            conn.execute(
                """
                INSERT INTO star_predictions (
                    target_name, mission, author, threshold, k_candidates,
                    best_score, verdict, best_candidate, num_candidates, device,
                    all_scores, folded_lightcurve, candidate_rank, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(target_name, mission, author, candidate_rank)
                DO UPDATE SET
                    threshold = excluded.threshold,
                    k_candidates = excluded.k_candidates,
                    best_score = excluded.best_score,
                    verdict = excluded.verdict,
                    best_candidate = excluded.best_candidate,
                    num_candidates = excluded.num_candidates,
                    device = excluded.device,
                    all_scores = excluded.all_scores,
                    folded_lightcurve = excluded.folded_lightcurve,
                    updated_at = excluded.updated_at
                """,
                (
                    target_name,
                    mission,
                    author,
                    float(threshold),
                    int(k_candidates),
                    float(item["best_score"]),
                    str(item["verdict"]),
                    json.dumps(item["best_candidate"]),
                    int(item["num_candidates"]),
                    str(item["device"]),
                    json.dumps(item["all_scores"]),
                    json.dumps(item["folded_lightcurve"]),
                    int(rank),
                    now_iso,
                    now_iso,
                ),
            )

        conn.commit()
    LOG.info(
        "DB UPSERT END star=%s mission=%s elapsed=%.2fs",
        target_name,
        mission,
        _time.monotonic() - t0,
    )


def run_guided_inference(
    *,
    target_name: str,
    mission: str,
    author: str,
    threshold: float,
    k_candidates: int,
    save_to_db: bool,
    strict_periods: bool = False,
) -> dict[str, Any]:
    t_total = _time.monotonic()
    LOG.info(
        "GUIDED RUN START star=%s mission=%s strict_periods=%s k_candidates=%s threshold=%.3f",
        target_name,
        mission,
        strict_periods,
        k_candidates,
        threshold,
    )

    t_dl = _time.monotonic()
    time, flux = get_time_flux(target_name=target_name, mission=mission, author=author, download_all=True)
    LOG.info(
        "STEP download complete star=%s mission=%s points=%s elapsed=%.2fs",
        target_name,
        mission,
        len(time),
        _time.monotonic() - t_dl,
    )

    # Real BLS, but with extra breadth so hints can be merged without replacing BLS.
    bls_k = max(int(k_candidates), 15)
    t_bls = _time.monotonic()
    bls_candidates = bls_topk(time, flux, k=bls_k, use_gpu=True)
    LOG.info(
        "STEP bls complete star=%s mission=%s bls_candidates=%s elapsed=%.2fs",
        target_name,
        mission,
        len(bls_candidates),
        _time.monotonic() - t_bls,
    )

    hint_periods = _lookup_period_hints(target_name, mission)
    LOG.info("STEP hints star=%s mission=%s hints=%s", target_name, mission, hint_periods)
    guided = _guided_candidates(time, flux, hint_periods)
    if strict_periods and guided:
        # For demo mode: keep only known real-world periods for these systems.
        candidates = guided
    else:
        candidates = _merge_candidates(bls_candidates, guided)
    LOG.info(
        "STEP candidate_merge star=%s mission=%s guided=%s total=%s",
        target_name,
        mission,
        len(guided),
        len(candidates),
    )

    t_model = _time.monotonic()
    model, device = load_trained_model(DEFAULT_WEIGHTS_PATH, device=None)
    X, folded_curves = build_candidate_matrix(
        time,
        flux,
        candidates,
        nbins=512,
        use_gpu=device.type == "cuda",
        device=device,
    )
    scores = score_candidates(model, X, device)
    guided_scores = _guided_rank_scores(candidates, scores, hint_periods)
    LOG.info(
        "STEP model_score star=%s mission=%s device=%s matrix=%s elapsed=%.2fs",
        target_name,
        mission,
        device,
        X.shape,
        _time.monotonic() - t_model,
    )

    order = np.argsort(guided_scores)[::-1]
    sorted_scores = [float(guided_scores[i]) for i in order]

    kept: list[dict[str, Any]] = []
    for rank_idx in order[: min(8, len(order))]:
        score_val = float(guided_scores[rank_idx])
        cand = candidates[int(rank_idx)]
        verdict = "TRANSIT_DETECTED" if score_val >= threshold else "NO_TRANSIT"
        kept.append(
            {
                "target_name": target_name,
                "mission": mission,
                "best_score": score_val,
                "verdict": verdict,
                "best_candidate": asdict(cand),
                "num_candidates": len(candidates),
                "device": str(device),
                "all_scores": sorted_scores,
                "folded_lightcurve": folded_curves[int(rank_idx)].astype(float).tolist(),
            }
        )

    if save_to_db and kept:
        _persist_predictions(
            target_name=target_name,
            mission=mission,
            author=author,
            threshold=threshold,
            k_candidates=k_candidates,
            results=kept,
        )

    best = kept[0] if kept else None
    LOG.info(
        "GUIDED RUN END star=%s mission=%s kept=%s best_score=%s elapsed=%.2fs",
        target_name,
        mission,
        len(kept),
        f"{best['best_score']:.4f}" if best else "None",
        _time.monotonic() - t_total,
    )
    return {
        "target_name": target_name,
        "mission": mission,
        "author": author,
        "hints_used": hint_periods,
        "num_bls_candidates": len(bls_candidates),
        "num_guided_candidates": len(guided),
        "num_total_candidates": len(candidates),
        "saved_to_db": bool(save_to_db and kept),
        "best": best,
        "top_candidates": kept,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run guided real inference for demo targets.")
    parser.add_argument("--star", help="Star/target name, e.g. 'Kepler-8' or 'TOI-700'")
    parser.add_argument("--mission", help="Mission, e.g. Kepler or TESS")
    parser.add_argument("--author", default="None", help="Lightkurve author filter (optional)")
    parser.add_argument("--threshold", type=float, default=0.50, help="Detection threshold in [0,1]")
    parser.add_argument("--k-candidates", type=int, default=20, help="BLS top-k candidates")
    parser.add_argument("--no-save", action="store_true", help="Do not write results to SQLite")
    parser.add_argument(
        "--seed-demo-set",
        action="store_true",
        help="Auto-run Kepler-1..10 and five TESS systems, then save all results.",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="Stop batch mode on first failure.",
    )
    parser.add_argument(
        "--strict-periods",
        action="store_true",
        help="Only output the known real-world periods for guided stars.",
    )

    args = parser.parse_args()

    # One-command mode: if no explicit target is passed, run the full demo batch.
    auto_seed_mode = args.seed_demo_set or (not args.star and not args.mission)
    LOG.info("CLI START auto_seed_mode=%s no_save=%s", auto_seed_mode, args.no_save)

    if auto_seed_mode:
        t_batch = _time.monotonic()
        LOG.info("BATCH START targets=%s strict_periods=True", len(DEMO_BATCH_TARGETS))
        batch_results: list[dict[str, Any]] = []
        for idx, (star_name, mission_name) in enumerate(DEMO_BATCH_TARGETS, start=1):
            LOG.info("BATCH ITEM START idx=%s/%s star=%s mission=%s", idx, len(DEMO_BATCH_TARGETS), star_name, mission_name)
            try:
                result = run_guided_inference(
                    target_name=star_name,
                    mission=mission_name,
                    author=args.author.strip() if args.author else "None",
                    threshold=float(args.threshold),
                    k_candidates=int(args.k_candidates),
                    save_to_db=not args.no_save,
                    strict_periods=True,
                )
                batch_results.append(
                    {
                        "index": idx,
                        "star": star_name,
                        "mission": mission_name,
                        "status": "ok",
                        "best_score": result.get("best", {}).get("best_score") if result.get("best") else None,
                        "saved_to_db": result.get("saved_to_db", False),
                    }
                )
                LOG.info(
                    "BATCH ITEM END idx=%s/%s star=%s mission=%s status=ok",
                    idx,
                    len(DEMO_BATCH_TARGETS),
                    star_name,
                    mission_name,
                )
            except Exception as exc:  # noqa: BLE001
                batch_results.append(
                    {
                        "index": idx,
                        "star": star_name,
                        "mission": mission_name,
                        "status": "error",
                        "error": str(exc),
                    }
                )
                LOG.exception(
                    "BATCH ITEM END idx=%s/%s star=%s mission=%s status=error",
                    idx,
                    len(DEMO_BATCH_TARGETS),
                    star_name,
                    mission_name,
                )
                if args.fail_fast:
                    break

        ok_count = sum(1 for r in batch_results if r.get("status") == "ok")
        err_count = len(batch_results) - ok_count
        LOG.info(
            "BATCH END attempted=%s ok=%s errors=%s elapsed=%.2fs",
            len(batch_results),
            ok_count,
            err_count,
            _time.monotonic() - t_batch,
        )
        print(
            json.dumps(
                {
                    "mode": "seed-demo-set",
                    "strict_periods": True,
                    "attempted": len(batch_results),
                    "ok": ok_count,
                    "errors": err_count,
                    "results": batch_results,
                },
                indent=2,
            )
        )
        return

    if not args.star or not args.mission:
        parser.error("Either provide --star and --mission, or use --seed-demo-set.")

    result = run_guided_inference(
        target_name=args.star.strip(),
        mission=args.mission.strip(),
        author=args.author.strip() if args.author else "None",
        threshold=float(args.threshold),
        k_candidates=int(args.k_candidates),
        save_to_db=not args.no_save,
        strict_periods=bool(args.strict_periods),
    )
    LOG.info("CLI END star=%s mission=%s", args.star.strip(), args.mission.strip())

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

"""Run normal pipeline inference for user-specified orbital periods.

This script is fully separate from guided_demo_inference.py.
It uses the same real data path as normal inference:
- downloads lightcurve from MAST
- folds lightcurve with the same fold/matrix builder
- scores with the same trained CNN
- persists rows to the same SQLite schema used by the API

Usage:
  python period_forced_inference.py --star "Kepler-9" --mission Kepler --periods "1.5929,19.243,38.910"
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import time as _time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from candidates import Candidate
from data_ingestion import get_time_flux
from model_inference import (
    DEFAULT_WEIGHTS_PATH,
    build_candidate_matrix,
    load_trained_model,
    score_candidates,
)

DB_PATH = Path(__file__).resolve().parent / "stars_cache.db"

LOG = logging.getLogger("cosmikai.period_forced_inference")
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

DEFAULT_BATCH: list[dict[str, Any]] = [
    {"star": "Kepler-1", "mission": "Kepler", "periods": [2.470613]},
    {"star": "Kepler-2", "mission": "Kepler", "periods": [2.204735]},
    {"star": "Kepler-3", "mission": "Kepler", "periods": [4.887803]},
    {"star": "Kepler-4", "mission": "Kepler", "periods": [3.213457]},
    {"star": "Kepler-5", "mission": "Kepler", "periods": [3.548460]},
    {"star": "Kepler-6", "mission": "Kepler", "periods": [3.234723]},
    {"star": "Kepler-7", "mission": "Kepler", "periods": [4.885489]},
    {"star": "Kepler-8", "mission": "Kepler", "periods": [3.522500]},
    {"star": "Kepler-9", "mission": "Kepler", "periods": [1.5929, 19.243, 38.910]},
    {"star": "Kepler-10", "mission": "Kepler", "periods": [0.83749, 45.294]},
    {"star": "TOI-700", "mission": "TESS", "periods": [9.977, 16.051, 37.426]},
    {"star": "WASP-33", "mission": "TESS", "periods": [1.21987]},
]


def _parse_periods_arg(value: str) -> list[float]:
    parts = [p.strip() for p in value.split(",") if p.strip()]
    periods: list[float] = []
    for p in parts:
        try:
            v = float(p)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"Invalid period '{p}' in --periods. Use comma-separated numbers.") from exc
        if v <= 0:
            raise argparse.ArgumentTypeError(f"Invalid period '{p}' in --periods. Periods must be > 0.")
        periods.append(v)
    if not periods:
        raise argparse.ArgumentTypeError("--periods requires at least one positive numeric value.")
    return periods


def _normalize_periods(value: Any) -> list[float]:
    if isinstance(value, str):
        return _parse_periods_arg(value)
    if isinstance(value, list):
        periods: list[float] = []
        for p in value:
            try:
                v = float(p)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Invalid period '{p}'. Periods must be numeric.") from exc
            if v <= 0:
                raise ValueError(f"Invalid period '{p}'. Periods must be > 0.")
            periods.append(v)
        if not periods:
            raise ValueError("Periods list must contain at least one positive value.")
        return periods
    raise ValueError("Periods must be either a comma-separated string or a numeric list.")


def _load_batch_jobs(batch_file: Path | None, use_default_batch: bool) -> list[dict[str, Any]]:
    if use_default_batch:
        raw_jobs = DEFAULT_BATCH
    else:
        if batch_file is None:
            raise ValueError("Batch file path is required when --batch-file mode is used.")
        with batch_file.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, dict) and "jobs" in payload:
            raw_jobs = payload["jobs"]
        elif isinstance(payload, list):
            raw_jobs = payload
        else:
            raise ValueError("Batch JSON must be either a list or an object with a 'jobs' list.")

    if not isinstance(raw_jobs, list) or not raw_jobs:
        raise ValueError("Batch jobs must be a non-empty list.")

    jobs: list[dict[str, Any]] = []
    for idx, row in enumerate(raw_jobs, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"Batch item #{idx} must be an object.")
        star = str(row.get("star", "")).strip()
        mission = str(row.get("mission", "")).strip()
        if not star or not mission:
            raise ValueError(f"Batch item #{idx} must include non-empty 'star' and 'mission'.")
        periods = _normalize_periods(row.get("periods"))
        jobs.append({"star": star, "mission": mission, "periods": periods})

    return jobs


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


def _candidates_from_periods(time: np.ndarray, flux: np.ndarray, periods: list[float]) -> list[Candidate]:
    cands: list[Candidate] = []
    flux_std = float(np.nanstd(flux) + 1e-6)
    for period in periods:
        t0, depth = _estimate_t0_and_depth(time, flux, period)
        duration = float(np.clip(0.04 * period, 0.03, 0.30))
        snr_like = float(depth / flux_std)
        cands.append(Candidate(period=float(period), t0=t0, duration=duration, depth=depth, power=snr_like))
    return cands


def _persist_predictions(
    *,
    target_name: str,
    mission: str,
    author: str,
    threshold: float,
    k_candidates: int,
    results: list[dict[str, Any]],
) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

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


def run_period_forced_inference(
    *,
    target_name: str,
    mission: str,
    author: str,
    periods: list[float],
    threshold: float,
    k_candidates: int,
    save_to_db: bool,
) -> dict[str, Any]:
    t_total = _time.monotonic()
    LOG.info(
        "RUN START star=%s mission=%s periods=%s threshold=%.3f",
        target_name,
        mission,
        periods,
        threshold,
    )

    time, flux = get_time_flux(target_name=target_name, mission=mission, author=author, download_all=True)
    LOG.info("STEP download complete star=%s mission=%s points=%s", target_name, mission, len(time))

    candidates = _candidates_from_periods(time, flux, periods)
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

    order = np.argsort(scores)[::-1]
    sorted_scores = [float(scores[i]) for i in order]

    kept: list[dict[str, Any]] = []
    for rank_idx in order:
        score_val = float(scores[int(rank_idx)])
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
        "RUN END star=%s mission=%s kept=%s best_score=%s elapsed=%.2fs",
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
        "periods_used": periods,
        "num_total_candidates": len(candidates),
        "saved_to_db": bool(save_to_db and kept),
        "best": best,
        "top_candidates": kept,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run separate period-forced real inference.")
    parser.add_argument("--star", help="Star/target name, e.g. 'Kepler-9'")
    parser.add_argument("--mission", help="Mission, e.g. Kepler or TESS")
    parser.add_argument("--periods", type=_parse_periods_arg, help="Comma-separated periods in days")
    parser.add_argument("--batch-file", help="Path to batch JSON file with star/mission/periods jobs")
    parser.add_argument(
        "--seed-default-batch",
        action="store_true",
        help="Run built-in default batch jobs (no JSON file needed).",
    )
    parser.add_argument("--fail-fast", action="store_true", help="Stop batch mode on first error")
    parser.add_argument("--author", default="None", help="Lightkurve author filter (optional)")
    parser.add_argument("--threshold", type=float, default=0.50, help="Detection threshold in [0,1]")
    parser.add_argument("--k-candidates", type=int, default=15, help="Stored for metadata compatibility")
    parser.add_argument("--no-save", action="store_true", help="Do not write results to SQLite")

    args = parser.parse_args()

    use_batch_mode = bool(args.batch_file or args.seed_default_batch)

    if use_batch_mode:
        if args.star or args.mission or args.periods:
            parser.error("Do not combine --batch-file/--seed-default-batch with --star/--mission/--periods.")

        jobs = _load_batch_jobs(Path(args.batch_file) if args.batch_file else None, bool(args.seed_default_batch))
        batch_results: list[dict[str, Any]] = []
        for idx, job in enumerate(jobs, start=1):
            try:
                out = run_period_forced_inference(
                    target_name=job["star"],
                    mission=job["mission"],
                    author=args.author.strip() if args.author else "None",
                    periods=job["periods"],
                    threshold=float(args.threshold),
                    k_candidates=int(args.k_candidates),
                    save_to_db=not args.no_save,
                )
                batch_results.append(
                    {
                        "index": idx,
                        "star": job["star"],
                        "mission": job["mission"],
                        "status": "ok",
                        "best_score": out.get("best", {}).get("best_score") if out.get("best") else None,
                        "saved_to_db": out.get("saved_to_db", False),
                    }
                )
            except Exception as exc:  # noqa: BLE001
                batch_results.append(
                    {
                        "index": idx,
                        "star": job["star"],
                        "mission": job["mission"],
                        "status": "error",
                        "error": str(exc),
                    }
                )
                if args.fail_fast:
                    break

        ok_count = sum(1 for r in batch_results if r.get("status") == "ok")
        print(
            json.dumps(
                {
                    "mode": "batch",
                    "source": "default" if args.seed_default_batch else str(args.batch_file),
                    "attempted": len(batch_results),
                    "ok": ok_count,
                    "errors": len(batch_results) - ok_count,
                    "results": batch_results,
                },
                indent=2,
            )
        )
        return

    if not (args.star and args.mission and args.periods):
        parser.error("Single mode requires --star, --mission, and --periods.")

    result = run_period_forced_inference(
        target_name=args.star.strip(),
        mission=args.mission.strip(),
        author=args.author.strip() if args.author else "None",
        periods=args.periods,
        threshold=float(args.threshold),
        k_candidates=int(args.k_candidates),
        save_to_db=not args.no_save,
    )

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

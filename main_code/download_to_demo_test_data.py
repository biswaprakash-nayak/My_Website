"""Download and convert a real lightcurve to CSV for upload demo testing.

Example:
  python download_to_demo_test_data.py --star "Kepler-22" --mission Kepler
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from data_ingestion import get_time_flux


def _safe_stem(value: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() else "_" for ch in value.strip())
    while "__" in out:
        out = out.replace("__", "_")
    out = out.strip("_")
    return out or "demo_lightcurve"


def main() -> None:
    parser = argparse.ArgumentParser(description="Download a real lightcurve and save as CSV in demo_test_data.")
    parser.add_argument("--star", default="Kepler-22", help="Exoplanet host star name")
    parser.add_argument("--mission", default="Kepler", help="Mission name")
    parser.add_argument("--author", default="None", help="Optional author filter")
    parser.add_argument("--download-all", action="store_true", help="Download and stitch all products")
    args = parser.parse_args()

    time_arr, flux_arr = get_time_flux(
        target_name=args.star,
        mission=args.mission,
        author=args.author,
        download_all=args.download_all,
    )
    time_arr = np.asarray(time_arr, dtype=np.float64)
    flux_arr = np.asarray(flux_arr, dtype=np.float64)

    out_dir = Path(__file__).resolve().parent / "demo_test_data"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"{_safe_stem(args.star)}_{_safe_stem(args.mission)}.csv"
    out_path = out_dir / out_name

    matrix = np.column_stack([time_arr.astype(np.float64), flux_arr.astype(np.float64)])
    np.savetxt(out_path, matrix, delimiter=",", header="time,flux", comments="")

    print(f"Saved: {out_path}")
    print(f"Rows: {matrix.shape[0]}")


if __name__ == "__main__":
    main()

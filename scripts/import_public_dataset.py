"""
Convert one of the supplementary XLSX files from the public cloud-performance
dataset into the normalized CSV expected by AutoTune.

Usage:
    python scripts/import_public_dataset.py path/to/mmc2.xlsx
"""

import sys
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ml-service" / "data" / "public_performance.csv"

if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/import_public_dataset.py path/to/file.xlsx")

source = Path(sys.argv[1])
if not source.exists():
    raise SystemExit(f"File not found: {source}")

df = pd.read_excel(source)

# Try common header names; otherwise preserve the paper's F1-F9/R1-R3 order.
rename = {
    "F1": "traffic",
    "f1": "traffic",
    "F2": "active_users",
    "f2": "active_users",
    "R1": "memory_usage",
    "r1": "memory_usage",
    "R2": "cpu_usage",
    "r2": "cpu_usage",
    "R3": "response_time",
    "r3": "response_time",
    "Memory Utilization": "memory_usage",
    "CPU Utilization": "cpu_usage",
    "Response Time": "response_time",
}
df = df.rename(columns=rename)

required = {"traffic", "active_users", "memory_usage", "cpu_usage", "response_time"}

if not required.issubset(df.columns):
    numeric = df.apply(pd.to_numeric, errors="coerce").dropna(axis=1, how="all")
    if numeric.shape[1] < 12:
        raise SystemExit(
            "Could not identify the expected F1-F9/R1-R3 structure. "
            "Inspect the XLSX columns and adjust the importer."
        )
    df = pd.DataFrame({
        "traffic": numeric.iloc[:, 0],
        "active_users": numeric.iloc[:, 1],
        "memory_usage": numeric.iloc[:, 9],
        "cpu_usage": numeric.iloc[:, 10],
        "response_time": numeric.iloc[:, 11],
    })

df["db_query_time"] = df["response_time"] * 0.35
df["system_load"] = df["cpu_usage"] / 12

columns = [
    "traffic", "active_users", "cpu_usage", "memory_usage",
    "response_time", "db_query_time", "system_load"
]

out = df[columns].apply(pd.to_numeric, errors="coerce").dropna()
OUT.parent.mkdir(parents=True, exist_ok=True)
out.to_csv(OUT, index=False)

print(f"Wrote {len(out):,} rows to {OUT}")

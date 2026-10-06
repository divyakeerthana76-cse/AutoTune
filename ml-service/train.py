import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)

FEATURES = [
    "traffic",
    "active_users",
    "cpu_usage",
    "memory_usage",
    "response_time",
    "db_query_time",
    "system_load",
]

def make_label(df):
    response_score = np.clip(df["response_time"] / 1500 * 100, 0, 100)
    pressure = (
        df["cpu_usage"] * 0.30
        + df["memory_usage"] * 0.15
        + response_score * 0.35
        + np.clip(df["db_query_time"] / 800 * 100, 0, 100) * 0.20
    )
    return np.select(
        [pressure >= 72, pressure >= 48],
        ["HIGH_LOAD", "WARNING"],
        default="NORMAL",
    )

def normalize_public_frame(raw):
    # Common naming variants first.
    aliases = {
        "traffic": ["traffic", "jobs_per_minute", "f1", "F1"],
        "active_users": ["active_users", "jobs_5min", "f2", "F2"],
        "cpu_usage": ["cpu_usage", "cpu_utilization", "r2", "R2"],
        "memory_usage": ["memory_usage", "memory_utilization", "r1", "R1"],
        "response_time": ["response_time", "response_time_ms", "r3", "R3"],
        "db_query_time": ["db_query_time", "database_time", "query_time"],
        "system_load": ["system_load", "load"],
    }

    result = pd.DataFrame(index=raw.index)
    for target, names in aliases.items():
        found = next((n for n in names if n in raw.columns), None)
        if found is not None:
            result[target] = pd.to_numeric(raw[found], errors="coerce")

    # Public paper data has nine workload parameters and three responses.
    # If explicit names are absent, use the F/R positional convention.
    if len(result.columns) < 5:
        numeric = raw.apply(pd.to_numeric, errors="coerce")
        numeric = numeric.dropna(axis=1, how="all")
        if numeric.shape[1] >= 12:
            result = pd.DataFrame({
                "traffic": numeric.iloc[:, 0],
                "active_users": numeric.iloc[:, 1],
                "cpu_usage": numeric.iloc[:, 10],
                "memory_usage": numeric.iloc[:, 9],
                "response_time": numeric.iloc[:, 11],
            })

    if "db_query_time" not in result:
        result["db_query_time"] = result["response_time"] * 0.35
    if "system_load" not in result:
        result["system_load"] = result["cpu_usage"] / 12

    return result[FEATURES]

def load_data(csv_path=None):
    path = Path(csv_path) if csv_path else DATA / "demo_performance.csv"
    df = pd.read_csv(path)

    if set(FEATURES).issubset(df.columns):
        df = df[FEATURES].copy()
    else:
        df = normalize_public_frame(df)

    for col in FEATURES:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.replace([np.inf, -np.inf], np.nan).dropna()
    df = df[(df["cpu_usage"] >= 0) & (df["cpu_usage"] <= 100)]
    df = df[(df["memory_usage"] >= 0) & (df["memory_usage"] <= 100)]
    df["label"] = make_label(df)

    return df

def evaluate(model, X_test, y_test):
    pred = model.predict(X_test)
    p, r, f1, _ = precision_recall_fscore_support(
        y_test, pred, average="weighted", zero_division=0
    )
    return {
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "precision_weighted": round(float(p), 4),
        "recall_weighted": round(float(r), 4),
        "f1_weighted": round(float(f1), 4),
        "confusion_matrix": confusion_matrix(y_test, pred, labels=["NORMAL", "WARNING", "HIGH_LOAD"]).tolist(),
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=None)
    args = parser.parse_args()

    df = load_data(args.csv)
    X = df[FEATURES]
    y = df["label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    logistic = Pipeline([
        ("scale", StandardScaler()),
        ("model", LogisticRegression(max_iter=1500))
    ])
    forest = RandomForestClassifier(
        n_estimators=220,
        max_depth=12,
        min_samples_leaf=2,
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
    )

    logistic.fit(X_train, y_train)
    forest.fit(X_train, y_train)

    log_metrics = evaluate(logistic, X_test, y_test)
    rf_metrics = evaluate(forest, X_test, y_test)

    chosen = forest if rf_metrics["f1_weighted"] >= log_metrics["f1_weighted"] else logistic
    chosen_name = "Random Forest" if chosen is forest else "Logistic Regression"

    joblib.dump(chosen, ARTIFACTS / "model.joblib")

    importances = None
    if chosen is forest:
        importances = sorted(
            [
                {"feature": f, "importance": round(float(v), 5)}
                for f, v in zip(FEATURES, forest.feature_importances_)
            ],
            key=lambda x: x["importance"],
            reverse=True,
        )
    else:
        coef = np.abs(chosen.named_steps["model"].coef_).mean(axis=0)
        importances = sorted(
            [
                {"feature": f, "importance": round(float(v), 5)}
                for f, v in zip(FEATURES, coef)
            ],
            key=lambda x: x["importance"],
            reverse=True,
        )

    metadata = {
        "available": True,
        "model": chosen_name,
        "features": FEATURES,
        "classes": ["NORMAL", "WARNING", "HIGH_LOAD"],
        "dataset_rows": int(len(df)),
        "training_rows": int(len(X_train)),
        "testing_rows": int(len(X_test)),
        "logistic_regression": log_metrics,
        "random_forest": rf_metrics,
        "selected_metrics": rf_metrics if chosen is forest else log_metrics,
        "feature_importance": importances,
        "label_method": "Derived operational pressure: 30% CPU + 15% memory + 35% response-time score + 20% DB latency score; >=72 HIGH_LOAD, >=48 WARNING.",
    }

    (ARTIFACTS / "model_info.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    print(json.dumps(metadata, indent=2))

if __name__ == "__main__":
    main()

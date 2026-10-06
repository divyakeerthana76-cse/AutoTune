from pathlib import Path
import json
import joblib
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "artifacts" / "model.joblib"
INFO_PATH = ROOT / "artifacts" / "model_info.json"

app = FastAPI(title="AutoTune ML Service", version="1.0.0")

FEATURES = [
    "traffic",
    "active_users",
    "cpu_usage",
    "memory_usage",
    "response_time",
    "db_query_time",
    "system_load",
]

class Metrics(BaseModel):
    traffic: float = Field(ge=0)
    active_users: float = Field(ge=0)
    cpu_usage: float = Field(ge=0, le=100)
    memory_usage: float = Field(ge=0, le=100)
    response_time: float = Field(ge=0)
    db_query_time: float = Field(ge=0)
    system_load: float = Field(ge=0)

def get_model():
    if not MODEL_PATH.exists():
        return None
    return joblib.load(MODEL_PATH)

@app.get("/health")
def health():
    return {"ok": True, "model_loaded": MODEL_PATH.exists()}

@app.get("/model-info")
def model_info():
    if not INFO_PATH.exists():
        return {"available": False}
    return json.loads(INFO_PATH.read_text(encoding="utf-8"))

@app.post("/predict")
def predict(metrics: Metrics):
    model = get_model()
    if model is None:
        return {"prediction": "NORMAL", "probability": 0.5, "source": "untrained"}

    row = pd.DataFrame([[getattr(metrics, f) for f in FEATURES]], columns=FEATURES)
    prediction = model.predict(row)[0]

    probability = 0.5
    if hasattr(model, "predict_proba"):
        probs = model.predict_proba(row)[0]
        classes = list(model.classes_)
        probability = float(probs[classes.index(prediction)])

    return {
        "prediction": str(prediction),
        "probability": round(probability, 4),
        "source": "trained-model"
    }

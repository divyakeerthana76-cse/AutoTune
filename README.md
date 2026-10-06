# AutoTune — Self-Optimizing Web Application Using Machine Learning

AutoTune is a recruitment/demo-ready full-stack system that closes the loop:

**MONITOR → PREDICT → OPTIMIZE → RECOVER**

It is a real web application with:
- React + Vite frontend
- Node.js + Express backend
- PostgreSQL persistence
- Python + FastAPI ML service
- Random Forest + Logistic Regression comparison
- simulated traffic/load controls
- application-level autonomous optimization
- recovery logic
- before/after performance measurements
- optimization event history

## What makes this stronger than a normal ML dashboard?

The ML prediction is connected to a real control loop. A prediction can cause the application to:
1. enable response caching,
2. reduce database result size,
3. disable a deliberately expensive analytics component,
4. reduce repeated database work,
5. restore normal behavior after the system stabilizes.

The optimization is application-level and reversible. It does not modify PostgreSQL configuration or execute arbitrary SQL.

---

## 1. Architecture

```text
                         ┌─────────────────────────────┐
                         │        React / Vite         │
                         │  Live dashboard + controls  │
                         └──────────────┬──────────────┘
                                        │ HTTP
                                        ▼
                         ┌─────────────────────────────┐
                         │       Node / Express        │
                         │                             │
                         │ Metrics • Simulator • Loop  │
                         │ Optimization • API         │
                         └───────┬───────────┬─────────┘
                                 │           │
                           SQL   │           │ HTTP
                                 ▼           ▼
                     ┌────────────────┐   ┌─────────────────┐
                     │  PostgreSQL    │   │ Python / FastAPI│
                     │ metrics/events │   │ Random Forest   │
                     └────────────────┘   └─────────────────┘
```

---

## 2. Dataset / ML methodology

The repository references the public dataset:

**Al-Faifi et al., "Data on performance prediction for cloud service selection" (Data in Brief, 2018).**

The source reports 28,147 instances from 13 cloud nodes, with workload parameters and performance metrics including memory utilization, CPU utilization, and response time. The article also provides supplementary XLSX files.

Source:
https://pmc.ncbi.nlm.nih.gov/articles/PMC6138836/

The original dataset is not bundled into this repository. Use the import script to convert one of the supplementary XLSX files into the normalized CSV expected by the training pipeline.

### Important modeling decision

The original dataset does not contain our exact `NORMAL / WARNING / HIGH_LOAD` application-state label. Therefore this project creates a **derived operational label** from CPU utilization, memory utilization, and normalized response time. The threshold is documented in `ml-service/train.py`.

This is an engineering label for the control loop, not a claim that the original authors used these exact classes.

For a club demo, the repository also contains `ml-service/data/demo_performance.csv`, a small deterministic demo dataset so the entire system can run without downloading the research dataset.

---

## 3. Requirements

For local development:
- Node.js 20+
- Python 3.11+
- PostgreSQL 15+ OR Docker Desktop
- npm

The easiest route is Docker for PostgreSQL, while running frontend/backend/ML locally.

---

## 4. Fastest way to run

### Option A — Docker Compose

```bash
docker compose up --build
```

Then open:

- Frontend: http://localhost:5173
- Backend health: http://localhost:4000/api/health
- ML health: http://localhost:8000/health

If you use the Docker profile, the frontend is served by Vite's development server inside the container.

### Option B — Local services

#### Terminal 1 — database

Create a PostgreSQL database (Supabase) named:

```text
autotune
```

#### Terminal 2 — backend

```bash
cd backend
npm install
npm run dev
```

#### Terminal 3 — ML service

```bash
cd ml-service
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
python train.py
uvicorn app:app --reload --port 8000
```

#### Terminal 4 — frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## 5. Environment variables

Backend `.env`:

```env
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/autotune
ML_SERVICE_URL=http://localhost:8000
CORS_ORIGIN=http://localhost:5173
```

Frontend `.env`:

```env
VITE_API_URL=http://localhost:4000/api
```

Docker uses equivalent internal service names automatically.

---

## 6. ML training

From `ml-service`:

```bash
python train.py
```

This:
- loads the demo CSV by default,
- validates and cleans the data,
- creates operational labels,
- trains Logistic Regression,
- trains Random Forest,
- evaluates accuracy / precision / recall / F1,
- saves the better model,
- writes metrics and feature importance to `artifacts/`.

To train on imported public data:

```bash
python train.py --csv data/public_performance.csv
```

The training output is intentionally saved so the dashboard can show the model's actual evaluation rather than hard-coded numbers.

---

## 7. Importing the public XLSX data

After downloading a supplementary XLSX file from the paper's PMC page:

```bash
python scripts/import_public_dataset.py path/to/mmc2.xlsx
```

The script writes:

```text
ml-service/data/public_performance.csv
```

The importer accepts both common names and the paper's F1–F9 / R1–R3 positional structure.

---

## 8. How the live loop works

Every simulation tick:

```text
traffic profile
      ↓
synthetic application activity
      ↓
backend records metrics
      ↓
ML prediction
      ↓
state = NORMAL / WARNING / HIGH_LOAD
      ↓
HIGH_LOAD?
   yes ↓
optimization engine
      ↓
cache + smaller DB page + heavy component off
      ↓
application workload decreases
      ↓
metrics recover
      ↓
NORMAL for several stable ticks
      ↓
restore standard configuration
```

The dashboard also has a manual **Demo Scenario** button that makes the full cycle visible quickly.

---

## 9. API overview

### GET `/api/health`
Backend health.

### GET `/api/dashboard`
Current metrics, ML prediction, optimization state, and history.

### POST `/api/simulator/profile`
Body:
```json
{"profile":"normal"}
```

Profiles:
- `normal`
- `medium`
- `high`
- `extreme`

### POST `/api/simulator/tick`
Generate one simulated workload tick.

### POST `/api/demo/run`
Runs an accelerated demonstration scenario.

### GET `/api/metrics?limit=60`
Recent metrics.

### GET `/api/events?limit=30`
Optimization/event history.

### GET `/api/model`
Latest ML evaluation metadata.

### POST `/api/optimize/manual`
Manually trigger optimization for testing.

---

## 10. Viva explanation

### What is the ML model predicting?

It predicts the application's **operational performance state** from workload/resource/performance metrics.

### Why Random Forest?

Performance degradation can depend on combinations of variables. Random Forest can model nonlinear interactions without requiring the team to manually specify every interaction.

### Why not directly "optimize the database"?

Because arbitrary query rewriting or database configuration changes would be unsafe for a student demo. AutoTune deliberately uses reversible application-level controls.

### Is the live data the same as the training data?

No.

- Training data: historical/public performance data.
- Live data: metrics generated by the running application and simulator.
- The ML model acts as the bridge between the two.

### Why simulate traffic?

A club demo cannot depend on hundreds or thousands of real users. The simulator creates controlled load patterns so the behavior can be reproduced on a laptop.

---

## 11. Demo script

1. Open dashboard.
2. Click **Run Demo Scenario**.
3. Watch traffic, CPU, DB latency and response time rise.
4. Watch the ML state move toward HIGH LOAD.
5. Observe automatic actions:
   - cache enabled
   - result limit reduced
   - expensive analytics disabled
6. Watch before/after metrics.
7. Let the recovery stage run.
8. Observe standard configuration being restored.
9. Open the event timeline and explain each state transition.

The strongest sentence for the demo:

> "We are not merely predicting a bottleneck; the prediction is connected to a reversible application-level control loop."

---

## 12. Project structure

```text
self-optimizing-web-app/
├── backend/
│   ├── src/
│   │   ├── db.js
│   │   ├── optimizer.js
│   │   ├── simulator.js
│   │   └── server.js
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   └── package.json
├── ml-service/
│   ├── data/demo_performance.csv
│   ├── artifacts/
│   ├── app.py
│   ├── train.py
│   └── requirements.txt
├── scripts/
│   └── import_public_dataset.py
├── docker-compose.yml
└── README.md
```

---

## 13. Disclaimer for the report

Do not report example metrics as measured results.

Run the training and demo, capture the actual values, and use those values in the final report.

The project deliberately exposes evaluation metrics and before/after measurements so your claims can be evidence-based.


## Public deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for GitHub + Supabase + Render + Vercel deployment.

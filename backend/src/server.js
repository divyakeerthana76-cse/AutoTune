import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDb, pool, getConfig, setConfig } from "./db.js";
import { makeMetrics } from "./simulator.js";
import { predict, shouldOptimize, shouldRecover } from "./optimizer.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || "*" }));
app.use(express.json());

let simulationProfile = "normal";
let lastPrediction = {
  prediction: "NORMAL",
  probability: 0.5,
  source: "boot"
};
let stableTicks = 0;
let demoRunning = false;
let demoTimer = null;

async function recordEvent(event_type, reason, details = {}) {
  await pool.query(
    `INSERT INTO optimization_events(event_type, reason, details)
     VALUES ($1, $2, $3)`,
    [event_type, reason, JSON.stringify(details)]
  );
}

async function tick(profile = simulationProfile) {
  const configBefore = await getConfig();
  const rawMetrics = makeMetrics(profile, configBefore);
  const ml = await predict(rawMetrics);

  lastPrediction = ml;

  if (ml.prediction === "NORMAL") stableTicks += 1;
  else stableTicks = 0;

  if (shouldOptimize(ml, configBefore)) {
    const config = await setConfig({
      cache_enabled: true,
      result_limit: 20,
      analytics_enabled: false
    });

    await recordEvent(
      "OPTIMIZATION_ACTIVATED",
      `ML predicted HIGH_LOAD with ${(ml.probability * 100).toFixed(0)}% confidence`,
      { actions: ["cache_enabled", "result_limit=20", "analytics_disabled"] }
    );

    const optimizedMetrics = makeMetrics(profile, config);
    const optimizedPrediction = await predict(optimizedMetrics);

    await pool.query(
      `INSERT INTO metrics
      (traffic, active_users, cpu_usage, memory_usage, response_time, db_query_time, system_load, state)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        optimizedMetrics.traffic,
        optimizedMetrics.active_users,
        optimizedMetrics.cpu_usage,
        optimizedMetrics.memory_usage,
        optimizedMetrics.response_time,
        optimizedMetrics.db_query_time,
        optimizedMetrics.system_load,
        optimizedPrediction.prediction
      ]
    );

    lastPrediction = optimizedPrediction;
    return { metrics: optimizedMetrics, prediction: optimizedPrediction, config };
  }

  if (shouldRecover(ml, configBefore, stableTicks)) {
    const config = await setConfig({
      cache_enabled: false,
      result_limit: 50,
      analytics_enabled: true
    });

    await recordEvent(
      "RECOVERY_COMPLETED",
      "Performance remained NORMAL for three consecutive monitoring ticks",
      { restored: true }
    );

    stableTicks = 0;

    await pool.query(
      `INSERT INTO metrics
      (traffic, active_users, cpu_usage, memory_usage, response_time, db_query_time, system_load, state)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        rawMetrics.traffic,
        rawMetrics.active_users,
        rawMetrics.cpu_usage,
        rawMetrics.memory_usage,
        rawMetrics.response_time,
        rawMetrics.db_query_time,
        rawMetrics.system_load,
        ml.prediction
      ]
    );

    return { metrics: rawMetrics, prediction: ml, config };
  }

  await pool.query(
    `INSERT INTO metrics
    (traffic, active_users, cpu_usage, memory_usage, response_time, db_query_time, system_load, state)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      rawMetrics.traffic,
      rawMetrics.active_users,
      rawMetrics.cpu_usage,
      rawMetrics.memory_usage,
      rawMetrics.response_time,
      rawMetrics.db_query_time,
      rawMetrics.system_load,
      ml.prediction
    ]
  );

  return { metrics: rawMetrics, prediction: ml, config: configBefore };
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "backend", database: "connected" });
  } catch {
    res.status(503).json({ ok: false, service: "backend", database: "unavailable" });
  }
});

app.get("/api/dashboard", async (_req, res) => {
  const { rows: metrics } = await pool.query(
    "SELECT * FROM metrics ORDER BY id DESC LIMIT 1"
  );
  const { rows: events } = await pool.query(
    "SELECT * FROM optimization_events ORDER BY id DESC LIMIT 12"
  );
  const config = await getConfig();

  res.json({
    metrics: metrics[0] || null,
    prediction: lastPrediction,
    config,
    profile: simulationProfile,
    demoRunning,
    events
  });
});

app.get("/api/metrics", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 60), 300);
  const { rows } = await pool.query(
    "SELECT * FROM metrics ORDER BY id DESC LIMIT $1",
    [limit]
  );
  res.json(rows.reverse());
});

app.get("/api/events", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 30), 100);
  const { rows } = await pool.query(
    "SELECT * FROM optimization_events ORDER BY id DESC LIMIT $1",
    [limit]
  );
  res.json(rows);
});

app.get("/api/model", async (_req, res) => {
  try {
    const response = await fetch(`${process.env.ML_SERVICE_URL || "http://localhost:8000"}/model-info`);
    const data = await response.json();
    res.json(data);
  } catch {
    res.json({ available: false });
  }
});

app.post("/api/simulator/profile", (req, res) => {
  const allowed = ["normal", "medium", "high", "extreme"];
  if (!allowed.includes(req.body.profile)) {
    return res.status(400).json({ error: "Invalid profile" });
  }
  simulationProfile = req.body.profile;
  res.json({ profile: simulationProfile });
});

app.post("/api/simulator/tick", async (_req, res) => {
  try {
    const result = await tick();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/optimize/manual", async (_req, res) => {
  try {
    const config = await setConfig({
      cache_enabled: true,
      result_limit: 20,
      analytics_enabled: false
    });
    await recordEvent(
      "MANUAL_OPTIMIZATION",
      "Optimization manually triggered for demonstration",
      { actions: ["cache_enabled", "result_limit=20", "analytics_disabled"] }
    );
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/demo/run", async (_req, res) => {
  if (demoRunning) return res.json({ demoRunning: true });

  demoRunning = true;
  await recordEvent(
    "DEMO_STARTED",
    "Accelerated MONITOR → PREDICT → OPTIMIZE → RECOVER demonstration started"
  );

  const phases = [
    ["normal", 4],
    ["medium", 4],
    ["high", 7],
    ["extreme", 6],
    ["medium", 4],
    ["normal", 6]
  ];

  let phaseIndex = 0;
  let ticksLeft = phases[0][1];

  const runNext = async () => {
    if (!demoRunning) return;
    const [profile] = phases[phaseIndex];
    simulationProfile = profile;

    try {
      await tick(profile);
    } catch (error) {
      await recordEvent("DEMO_ERROR", error.message);
    }

    ticksLeft -= 1;

    if (ticksLeft <= 0) {
      phaseIndex += 1;
      if (phaseIndex >= phases.length) {
        demoRunning = false;
        simulationProfile = "normal";
        await recordEvent(
          "DEMO_COMPLETED",
          "Demo scenario completed; system returned to normal profile"
        );
        clearInterval(demoTimer);
        demoTimer = null;
        return;
      }
      ticksLeft = phases[phaseIndex][1];
    }
  };

  await runNext();
  demoTimer = setInterval(runNext, 2500);

  res.json({ demoRunning: true });
});

await initDb();

app.listen(PORT, () => {
  console.log(`AutoTune backend running on http://localhost:${PORT}`);
});

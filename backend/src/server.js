
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
let demoGeneration = 0;

// Record an event in the database.
async function recordEvent(event_type, reason, details = {}) {
  await pool.query(
    `INSERT INTO optimization_events (event_type, reason, details)
     VALUES ($1, $2, $3)`,
    [event_type, reason, JSON.stringify(details)]
  );
}

// Generate metrics, ask the ML service for a prediction,
// and apply optimization/recovery rules.
async function tick(profile = simulationProfile) {
  const configBefore = await getConfig();
  const rawMetrics = makeMetrics(profile, configBefore);
  const ml = await predict(rawMetrics);

  lastPrediction = ml;

  if (ml.prediction === "NORMAL") {
    stableTicks += 1;
  } else {
    stableTicks = 0;
  }

  if (shouldOptimize(ml, configBefore)) {
    const config = await setConfig({
      cache_enabled: true,
      result_limit: 20,
      analytics_enabled: false
    });

    await recordEvent(
      "OPTIMIZATION_ACTIVATED",
      `ML predicted ${ml.prediction} with ${(ml.probability * 100).toFixed(0)}% confidence`,
      {
        actions: [
          "cache_enabled",
          "result_limit=20",
          "analytics_disabled"
        ],
        profile
      }
    );

    const optimizedMetrics = makeMetrics(profile, config);
    const optimizedPrediction = await predict(optimizedMetrics);

    await pool.query(
      `INSERT INTO metrics
       (traffic, active_users, cpu_usage, memory_usage,
        response_time, db_query_time, system_load, state, prediction, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        optimizedMetrics.traffic,
        optimizedMetrics.active_users,
        optimizedMetrics.cpu_usage,
        optimizedMetrics.memory_usage,
        optimizedMetrics.response_time,
        optimizedMetrics.db_query_time,
        optimizedMetrics.system_load,
        optimizedPrediction.prediction,
        optimizedPrediction.prediction,
        optimizedPrediction.probability
      ]
    );

    lastPrediction = optimizedPrediction;

    return {
      metrics: optimizedMetrics,
      prediction: optimizedPrediction,
      config,
      profile
    };
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
      { restored: true, profile }
    );

    stableTicks = 0;

    await pool.query(
      `INSERT INTO metrics
       (traffic, active_users, cpu_usage, memory_usage,
        response_time, db_query_time, system_load, state, prediction, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        rawMetrics.traffic,
        rawMetrics.active_users,
        rawMetrics.cpu_usage,
        rawMetrics.memory_usage,
        rawMetrics.response_time,
        rawMetrics.db_query_time,
        rawMetrics.system_load,
        ml.prediction,
        ml.prediction,
        ml.probability
      ]
    );

    return { metrics: rawMetrics, prediction: ml, config, profile };
  }

  await pool.query(
    `INSERT INTO metrics
     (traffic, active_users, cpu_usage, memory_usage,
      response_time, db_query_time, system_load, state, prediction, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      rawMetrics.traffic,
      rawMetrics.active_users,
      rawMetrics.cpu_usage,
      rawMetrics.memory_usage,
      rawMetrics.response_time,
      rawMetrics.db_query_time,
      rawMetrics.system_load,
      ml.prediction,
      ml.prediction,
      ml.probability
    ]
  );

  return {
    metrics: rawMetrics,
    prediction: ml,
    config: configBefore,
    profile
  };
}

// Health check.
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      service: "backend",
      database: "connected"
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "backend",
      database: "unavailable"
    });
  }
});

// Dashboard data.
app.get("/api/dashboard", async (_req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Historical metrics.
app.get("/api/metrics", async (req, res) => {
  try {
    const limit = Math.max(
      1,
      Math.min(Number(req.query.limit || 60), 300)
    );

    const { rows } = await pool.query(
      "SELECT * FROM metrics ORDER BY id DESC LIMIT $1",
      [limit]
    );

    res.json(rows.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Optimization event history.
app.get("/api/events", async (req, res) => {
  try {
    const limit = Math.max(
      1,
      Math.min(Number(req.query.limit || 30), 100)
    );

    const { rows } = await pool.query(
      "SELECT * FROM optimization_events ORDER BY id DESC LIMIT $1",
      [limit]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ML model information.
app.get("/api/model", async (_req, res) => {
  try {
    const response = await fetch(
      `${process.env.ML_SERVICE_URL || "http://localhost:8000"}/model-info`
    );

    if (!response.ok) {
      return res.status(502).json({ available: false });
    }

    res.json(await response.json());
  } catch {
    res.json({ available: false });
  }
});

// Manually select a profile.
// Manual selection takes priority over the running demo.
app.post("/api/simulator/profile", (req, res) => {
  const allowed = ["normal", "medium", "high", "extreme"];
  const requestedProfile = req.body?.profile;

  if (!allowed.includes(requestedProfile)) {
    return res.status(400).json({ error: "Invalid profile" });
  }

  simulationProfile = requestedProfile;

  // Invalidate the current demo timer so it cannot overwrite
  // the manually selected profile on its next scheduled tick.
  if (demoRunning) {
    demoGeneration += 1;
    demoRunning = false;

    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
  }

  res.json({
    profile: simulationProfile,
    demoRunning
  });
});

// Generate one monitoring tick using the selected profile.
app.post("/api/simulator/tick", async (_req, res) => {
  try {
    const result = await tick(simulationProfile);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manually activate optimization.
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
      {
        actions: [
          "cache_enabled",
          "result_limit=20",
          "analytics_disabled"
        ]
      }
    );

    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run the automated MONITOR → PREDICT → OPTIMIZE → RECOVER demo.
// The demo progresses through profiles unless a user manually
// selects a profile, which stops the automatic progression.
app.post("/api/demo/run", async (_req, res) => {
  if (demoRunning) {
    return res.json({ demoRunning: true });
  }

  demoRunning = true;
  const thisDemo = ++demoGeneration;

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

  try {
    await recordEvent(
      "DEMO_STARTED",
      "Accelerated MONITOR → PREDICT → OPTIMIZE → RECOVER demonstration started"
    );
  } catch (error) {
    demoRunning = false;
    return res.status(500).json({ error: error.message });
  }

  const runNext = async () => {
    // Ignore stale timers after manual selection or demo restart.
    if (!demoRunning || thisDemo !== demoGeneration) return;

    const [profile] = phases[phaseIndex];
    simulationProfile = profile;

    try {
      await tick(profile);
    } catch (error) {
      try {
        await recordEvent("DEMO_ERROR", error.message);
      } catch (eventError) {
        console.error("Could not record demo error:", eventError.message);
      }
    }

    // A manual profile selection may have stopped this demo
    // while the asynchronous tick was running.
    if (!demoRunning || thisDemo !== demoGeneration) return;

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

        if (demoTimer) {
          clearInterval(demoTimer);
          demoTimer = null;
        }

        return;
      }

      ticksLeft = phases[phaseIndex][1];
    }
  };

  await runNext();

  if (demoRunning && thisDemo === demoGeneration) {
    demoTimer = setInterval(runNext, 2500);
  }

  res.json({ demoRunning });
});

await initDb();

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`AutoTune backend running on http://localhost:${PORT}`);
  });
}

export default app;
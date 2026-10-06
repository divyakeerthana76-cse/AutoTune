const ML_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

export async function predict(metrics) {
  try {
    const response = await fetch(`${ML_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metrics)
    });
    if (!response.ok) throw new Error(`ML service ${response.status}`);
    return await response.json();
  } catch (error) {
    // Safe fallback keeps the demo usable if ML service is temporarily unavailable.
    const pressure =
      metrics.cpu_usage * 0.30 +
      metrics.memory_usage * 0.15 +
      Math.min(metrics.response_time / 20, 100) * 0.35 +
      Math.min(metrics.db_query_time / 10, 100) * 0.20;

    const state = pressure >= 72 ? "HIGH_LOAD" : pressure >= 48 ? "WARNING" : "NORMAL";
    return {
      prediction: state,
      probability: Number(Math.min(0.99, 0.55 + Math.abs(pressure - 60) / 100).toFixed(3)),
      source: "safe-fallback"
    };
  }
}

export function shouldOptimize(prediction, config) {
  return prediction.prediction === "HIGH_LOAD" && !config.cache_enabled;
}

export function shouldRecover(prediction, config, stableTicks) {
  return prediction.prediction === "NORMAL" && config.cache_enabled && stableTicks >= 3;
}

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

export const getDashboard = () => request("/dashboard");

export const getMetrics = () => request("/metrics?limit=60");

export const getModel = () => request("/model");

export const setProfile = (profile) =>
  request("/simulator/profile", {
    method: "POST",
    body: JSON.stringify({ profile })
  });

export const simulatorTick = () =>
  request("/simulator/tick", {
    method: "POST"
  });

export const runDemo = () =>
  request("/demo/run", {
    method: "POST"
  });

export const manualOptimize = () =>
  request("/optimize/manual", {
    method: "POST"
  });
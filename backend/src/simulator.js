const profiles = {
  normal:  { traffic: 140, users: 80,  pressure: 0.18 },
  medium:  { traffic: 420, users: 230, pressure: 0.42 },
  high:    { traffic: 850, users: 620, pressure: 0.72 },
  extreme: { traffic: 1400, users: 1100, pressure: 0.94 }
};

export function makeMetrics(profileName, config) {
  const p = profiles[profileName] || profiles.normal;
  const cacheBonus = config.cache_enabled ? 0.70 : 1;
  const analyticsBonus = config.analytics_enabled ? 1 : 0.78;
  const queryBonus = config.result_limit < 50 ? 0.72 : 1;

  const noise = () => (Math.random() - 0.5);

  const cpu = Math.max(
    4,
    Math.min(99, 18 + p.pressure * 76 * analyticsBonus * cacheBonus + noise() * 4)
  );

  const memory = Math.max(
    10,
    Math.min(99, 28 + p.pressure * 62 + noise() * 3)
  );

  const db = Math.max(
    12,
    38 + p.pressure * 720 * queryBonus * cacheBonus + noise() * 30
  );

  const response = Math.max(
    80,
    120 + p.pressure * 1450 * queryBonus * cacheBonus * analyticsBonus + noise() * 55
  );

  const systemLoad = Math.max(0.2, Math.min(12, cpu / 12 + p.pressure * 1.5));

  return {
    traffic: Math.round(p.traffic * (1 + noise() * 0.08)),
    active_users: Math.round(p.users * (1 + noise() * 0.05)),
    cpu_usage: Number(cpu.toFixed(2)),
    memory_usage: Number(memory.toFixed(2)),
    response_time: Number(response.toFixed(2)),
    db_query_time: Number(db.toFixed(2)),
    system_load: Number(systemLoad.toFixed(2))
  };
}

export { profiles };

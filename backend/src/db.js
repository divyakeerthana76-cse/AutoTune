js
import dotenv from "dotenv";
import path from "path";
import pg from "pg";

dotenv.config({
  path: path.resolve(process.cwd(), ".env")
});

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "DATABASE_URL is not set. Database features will be unavailable until configured."
  );
}

const pool = new Pool({
  connectionString,
  ssl:
    connectionString && !/localhost|127\.0\.0\.1/.test(connectionString)
      ? { rejectUnauthorized: false }
      : false,
  max: Number(process.env.DB_POOL_MAX || 3),
  min: 0,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  if (!connectionString) return;

  await query(`
    CREATE TABLE IF NOT EXISTS metrics (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      traffic DOUBLE PRECISION NOT NULL,
      active_users DOUBLE PRECISION NOT NULL,
      cpu_usage DOUBLE PRECISION NOT NULL,
      memory_usage DOUBLE PRECISION NOT NULL,
      response_time DOUBLE PRECISION NOT NULL,
      db_query_time DOUBLE PRECISION NOT NULL,
      system_load DOUBLE PRECISION NOT NULL,
      state VARCHAR(32),
      prediction VARCHAR(32),
      confidence DOUBLE PRECISION
    );

    CREATE TABLE IF NOT EXISTS optimization_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type VARCHAR(64) NOT NULL,
      reason VARCHAR(255),
      prediction VARCHAR(32),
      confidence DOUBLE PRECISION,
      details JSONB DEFAULT '{}'::JSONB
    );

    CREATE TABLE IF NOT EXISTS app_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      cache_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      result_limit INTEGER NOT NULL DEFAULT 100,
      analytics_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      simulation_profile VARCHAR(32) NOT NULL DEFAULT 'normal',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO app_config (
      id,
      cache_enabled,
      result_limit,
      analytics_enabled,
      simulation_profile
    )
    VALUES (
      1,
      FALSE,
      100,
      TRUE,
      'normal'
    )
    ON CONFLICT (id) DO NOTHING;

    CREATE INDEX IF NOT EXISTS idx_metrics_created_at
      ON metrics(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_events_created_at
      ON optimization_events(created_at DESC);
  `);

  console.log("Supabase/PostgreSQL database initialized.");
}

async function getConfig() {
  const { rows } = await pool.query(`
    SELECT
      cache_enabled,
      result_limit,
      analytics_enabled,
      simulation_profile
    FROM app_config
    WHERE id = 1
  `);

  return rows[0];
}

async function setConfig({
  cache_enabled,
  result_limit,
  analytics_enabled
}) {
  const { rows } = await pool.query(
    `
      UPDATE app_config
      SET cache_enabled = $1,
          result_limit = $2,
          analytics_enabled = $3,
          updated_at = NOW()
      WHERE id = 1
      RETURNING
        cache_enabled,
        result_limit,
        analytics_enabled,
        simulation_profile
    `,
    [
      cache_enabled,
      result_limit,
      analytics_enabled
    ]
  );

  return rows[0];
}

async function setSimulationProfile(profile) {
  const { rows } = await pool.query(
    `
      UPDATE app_config
      SET simulation_profile = $1,
          updated_at = NOW()
      WHERE id = 1
      RETURNING simulation_profile
    `,
    [profile]
  );

  return rows[0].simulation_profile;
}

export {
  pool,
  query,
  initDb,
  getConfig,
  setConfig,
  setSimulationProfile
};


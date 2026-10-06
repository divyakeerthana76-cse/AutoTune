import React, { useEffect, useState, useMemo } from "react";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Gauge,
  HardDrive,
  Layers3,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Zap
} from "lucide-react";
import {
  getDashboard,
  getMetrics,
  getModel,
  manualOptimize,
  runDemo,
  setProfile,
  simulatorTick
} from "./api";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

function MetricCard({ icon: Icon, label, value, unit, hint }) {
  return (
    <div className="metric-card">
      <div className="metric-icon"><Icon size={18} /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}<span>{unit}</span></div>
      <div className="metric-hint">{hint}</div>
    </div>
  );
}

function StatePill({ state }) {
  const cls = state === "HIGH_LOAD" ? "danger" : state === "WARNING" ? "warning" : "good";
  return <span className={`state-pill ${cls}`}>{state?.replace("_", " ") || "STARTING"}</span>;
}

export default function App() {
  const [dashboard, setDashboard] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [model, setModel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const refresh = async () => {
    try {
      const [d, m, ml] = await Promise.all([getDashboard(), getMetrics(), getModel()]);
      setDashboard(d);
      setMetrics(m);
      setModel(ml);
    } catch (e) {
      setToast("Backend is not reachable. Start the services first.");
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1800);
    return () => clearInterval(id);
  }, []);

  const act = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      setToast(message);
      await refresh();
    } catch {
      setToast("Action failed. Check the backend terminal.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 3000);
    }
  };

  const state = dashboard?.prediction?.prediction || "NORMAL";
  const probability = Math.round((dashboard?.prediction?.probability || 0) * 100);
  const config = dashboard?.config;
  const latest = dashboard?.metrics;

  const chartData = useMemo(() =>
    metrics.map((m, i) => ({
      i,
      response: Number(m.response_time),
      cpu: Number(m.cpu_usage),
      db: Number(m.db_query_time)
    })), [metrics]
  );

  const events = dashboard?.events || [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={20}/></div>
          <div>
            <div className="brand-name">AUTOTUNE</div>
            <div className="brand-sub">self-optimizing web application</div>
          </div>
        </div>
        <div className="top-actions">
          <span className="live-dot"><span /> LIVE MONITORING</span>
          <button className="ghost-btn" onClick={refresh}><RefreshCw size={16}/> Refresh</button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">AUTONOMOUS PERFORMANCE CONTROL</div>
            <h1>Performance that reacts<br/><em>before users feel it.</em></h1>
            <p>
              AutoTune watches application pressure, predicts degradation with ML,
              and applies reversible application-level optimizations automatically.
            </p>
          </div>
          <div className="hero-cycle">
            <div className="cycle-label">CONTROL LOOP</div>
            <div className="cycle">
              <span>MONITOR</span><b>→</b><span>PREDICT</span><b>→</b>
              <span className={config?.cache_enabled ? "active" : ""}>OPTIMIZE</span><b>→</b><span>RECOVER</span>
            </div>
            <button className="demo-btn" disabled={busy || dashboard?.demoRunning}
              onClick={() => act(runDemo, "Demo scenario started — watch the control loop.")}>
              <Play size={17} fill="currentColor"/> {dashboard?.demoRunning ? "DEMO RUNNING" : "RUN FULL DEMO"}
            </button>
          </div>
        </section>

        <section className="status-row">
          <div className="status-card">
            <div className="status-main">
              <div className={`status-orb ${state === "HIGH_LOAD" ? "red" : state === "WARNING" ? "amber" : ""}`}>
                <Activity size={25}/>
              </div>
              <div>
                <div className="section-kicker">SYSTEM STATUS</div>
                <div className="status-title"><StatePill state={state}/></div>
                <div className="muted">Traffic profile: <strong>{dashboard?.profile || "normal"}</strong></div>
              </div>
            </div>
            <div className="prediction-box">
              <div className="section-kicker">ML CONFIDENCE</div>
              <div className="confidence-number">{probability}%</div>
              <div className="confidence-bar"><span style={{width: `${probability}%`}}/></div>
              <div className="muted">model: {model?.model || "loading..."}</div>
            </div>
          </div>

          <div className="actions-card">
            <div className="section-kicker">AUTONOMOUS ACTIONS</div>
            <Action label="Response cache" active={config?.cache_enabled}/>
            <Action label="Reduced result set" active={config?.result_limit < 50}/>
            <Action label="Heavy analytics" active={config?.analytics_enabled === false} inverted/>
            <button className="small-btn" onClick={() => act(manualOptimize, "Manual optimization activated.")}>
              <Zap size={14}/> Force optimization
            </button>
          </div>
        </section>

        <section className="metrics-grid">
          <MetricCard icon={Gauge} label="CPU UTILIZATION" value={latest?.cpu_usage ?? "—"} unit="%" hint="server compute pressure"/>
          <MetricCard icon={HardDrive} label="MEMORY" value={latest?.memory_usage ?? "—"} unit="%" hint="working memory pressure"/>
          <MetricCard icon={Activity} label="RESPONSE TIME" value={latest?.response_time ?? "—"} unit="ms" hint="end-to-end simulated latency"/>
          <MetricCard icon={Server} label="DB LATENCY" value={latest?.db_query_time ?? "—"} unit="ms" hint="query workload pressure"/>
        </section>

        <section className="control-grid">
          <div className="panel chart-panel">
            <div className="panel-head">
              <div>
                <div className="section-kicker">LIVE TELEMETRY</div>
                <h2>Application pressure</h2>
              </div>
              <div className="legend"><span/> response <span/> cpu</div>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="responseFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopOpacity={0.22}/>
                      <stop offset="100%" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.12}/>
                  <XAxis dataKey="i" hide/>
                  <YAxis hide/>
                  <Tooltip contentStyle={{background:"#101318",border:"1px solid #252a34",borderRadius:12}}/>
                  <Area type="monotone" dataKey="response" strokeWidth={2.5} fill="url(#responseFill)" stroke="#d7e5ff"/>
                  <Area type="monotone" dataKey="cpu" strokeWidth={2} fill="none" stroke="#7d8ba3"/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel simulator-panel">
            <div className="section-kicker">LOAD LAB</div>
            <h2>Simulate traffic</h2>
            <p className="muted">Reproduce pressure on demand. The application remains deterministic enough for a repeatable club demo.</p>
            <div className="profiles">
              {["normal","medium","high","extreme"].map(p => (
                <button key={p}
                  className={dashboard?.profile === p ? "profile active" : "profile"}
                  onClick={() => act(async () => { await setProfile(p); await simulatorTick(); }, `${p.toUpperCase()} traffic profile selected.`)}>
                  <span>{p}</span>
                  <small>{p === "normal" ? "baseline" : p === "medium" ? "rising" : p === "high" ? "pressure" : "stress test"}</small>
                </button>
              ))}
            </div>
            <button className="tick-btn" onClick={() => act(simulatorTick, "One monitoring tick generated.")}>
              <Activity size={15}/> Generate monitoring tick
            </button>
          </div>
        </section>

        <section className="lower-grid">
          <div className="panel">
            <div className="panel-head">
              <div><div className="section-kicker">EVENT STREAM</div><h2>Optimization history</h2></div>
              <Layers3 size={18} className="muted"/>
            </div>
            <div className="timeline">
              {events.length === 0 && <div className="empty">No events yet. Run the demo to create the control-loop history.</div>}
              {events.map(e => (
                <div className="event" key={e.id}>
                  <div className="event-line"><span className="event-dot"/><span className="event-time">{new Date(e.created_at).toLocaleTimeString()}</span></div>
                  <div>
                    <strong>{e.event_type.replaceAll("_", " ")}</strong>
                    <p>{e.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel model-panel">
            <div className="section-kicker">MODEL CARD</div>
            <h2>Why the prediction is credible</h2>
            <div className="model-stat"><span>Selected model</span><b>{model?.model || "—"}</b></div>
            <div className="model-stat"><span>Test F1</span><b>{model?.selected_metrics ? `${(model.selected_metrics.f1_weighted*100).toFixed(1)}%` : "—"}</b></div>
            <div className="model-stat"><span>Dataset rows</span><b>{model?.dataset_rows?.toLocaleString() || "—"}</b></div>
            <div className="model-stat"><span>Features</span><b>{model?.features?.length || 7}</b></div>
            <div className="importance">
              <div className="section-kicker">TOP FEATURES</div>
              {(model?.feature_importance || []).slice(0,4).map((f) => (
                <div className="importance-row" key={f.feature}>
                  <span>{f.feature.replaceAll("_"," ")}</span>
                  <div><i style={{width:`${Math.min(100, f.importance*100*2)}%`}}/></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {toast && <div className="toast"><CheckCircle2 size={16}/>{toast}</div>}
      <footer>
        <span><ShieldCheck size={14}/> reversible application-level optimization</span>
        <span>AutoTune • Self-Optimizing Web Application</span>
      </footer>
    </div>
  );
}

function Action({label, active, inverted}) {
  const on = inverted ? active : active;
  return (
    <div className={`action ${on ? "on" : ""}`}>
      <span className="action-icon">{on ? <CheckCircle2 size={15}/> : <span className="off-dot"/>}</span>
      <span>{label}</span>
      <small>{on ? (inverted ? "disabled" : "enabled") : "standard"}</small>
    </div>
  );
}

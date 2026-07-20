import { css } from "uebersicht";

export const command = "claude-usage.widget/lib/run.sh";
// Übersicht requires a static export; keep in sync with config.json refreshSeconds.
export const refreshFrequency = 60000;

export const className = `
  bottom: 8px;
  left: 0;
  right: 0;
  display: flex;
  pointer-events: none;
`;

// config.position.align: "left" | "center" | "right"
const alignToJustify = (align) =>
  align === "right" ? "flex-end" : align === "left" ? "flex-start" : "center";

const GREEN = "#5ba97f", AMBER = "#d9a557", RED = "#d97757";

const pill = css`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 20px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92));
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  color: #e8eaf0;
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
`;

const sub = css` color: #9aa0b0; `;
const strong = css` color: #e8eaf0; font-weight: 600; `;
const divider = css` width: 1px; align-self: stretch; background: rgba(255, 255, 255, 0.1); `;
const barOuter = css`
  display: inline-block;
  width: 44px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  vertical-align: middle;
  margin: 0 5px 1px 6px;
  overflow: hidden;
`;

export const barColor = (pct) => (pct >= 80 ? RED : pct >= 50 ? AMBER : GREEN);
export const fmtCost = (n) => `$${n.toFixed(2)}`;
export const fmtTokens = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`;

export const fmtReset = (iso, now = new Date()) => {
  if (!iso) return "";
  const t = new Date(iso), ms = t - now;
  if (ms <= 0) return "now";
  if (ms < 24 * 3600e3) {
    const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  const day = t.toLocaleDateString(undefined, { weekday: "short" });
  const hr = t.toLocaleTimeString(undefined, { hour: "numeric" }).replace(" ", "").toLowerCase();
  return `${day} ${hr}`;
};

const Gauge = ({ label, pctUsed, resetsAt }) => (
  <span className={sub}>
    {label} <span className={strong}>{pctUsed}%</span>
    <span className={barOuter}>
      <span
        style={{
          display: "block", height: "100%", borderRadius: 2,
          width: `${Math.min(pctUsed, 100)}%`, background: barColor(pctUsed),
        }}
      />
    </span>
    {fmtReset(resetsAt)}
  </span>
);

const Ticker = ({ logs, limits, config }) => {
  const buckets = (limits.status === "ok" ? limits.buckets : []).filter(
    (b) => config.showFable !== false || b.id !== "week_fable"
  );
  return (
    <div className={pill}>
      <span className={strong}>✳</span>
      {logs.status === "ok" && (
        <span className={sub}>
          {config.showCost && <span className={strong}>{fmtCost(logs.today.costUsd)} </span>}
          · {fmtTokens(logs.today.tokens)}
        </span>
      )}
      {logs.status === "ok" && buckets.length > 0 && <span className={divider} />}
      {buckets.map((b) => (
        <Gauge key={b.id} label={b.label} pctUsed={b.pctUsed} resetsAt={b.resetsAt} />
      ))}
      {logs.status !== "ok" && limits.status !== "ok" && (
        <span className={sub}>claude-usage: no data ({logs.status}/{limits.status})</span>
      )}
    </div>
  );
};

const Positioned = ({ align, children }) => (
  <div style={{ display: "flex", width: "100%", justifyContent: alignToJustify(align), padding: "0 12px" }}>
    {children}
  </div>
);

export const render = ({ output }) => {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    return <Positioned align="center"><div className={pill}><span className={sub}>claude-usage: loading…</span></div></Positioned>;
  }
  if (payload.error === "node-missing")
    return <Positioned align="center"><div className={pill}><span className={sub}>{payload.message}</span></div></Positioned>;
  if (payload.error)
    return <Positioned align="center"><div className={pill}><span className={sub}>claude-usage error: {payload.message}</span></div></Positioned>;

  const { config } = payload;
  const align = (config.position && config.position.align) || "center";
  const { logs, limits } = payload.providers.claude;
  // layout dispatch — more layouts added in Tasks 4 and 11
  return (
    <Positioned align={align}>
      <Ticker logs={logs} limits={limits} config={config} />
    </Positioned>
  );
};

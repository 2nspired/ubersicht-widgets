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
const logo = css` color: #d97757; font-weight: 600; `;
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
export const fmtCost = (n) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtTokens = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`;
// Rough, order-of-magnitude estimate — see WH_PER_MTOK in lib/logs.js.
const Bolt = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" style={{ verticalAlign: "-1px", marginRight: 2 }}>
    <path fill="#d9a557" d="M13 2 4.7 13.2l5.9.4L9 22l10.3-12.2-6.4-.4L13 2z" />
  </svg>
);
export const fmtEnergy = (n) => (
  <span style={{ whiteSpace: "nowrap" }}><Bolt />{n ?? 0} kWh</span>
);
const joinParts = (parts) =>
  parts.filter(Boolean).map((part, i) => (
    <span key={i} style={{ display: "contents" }}>{i > 0 && " \u00b7 "}{part}</span>
  ));

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
  const tickerParts = [];
  if (logs.status === "ok") {
    if (config.showCost) tickerParts.push({ key: "cost", node: <span className={strong}>{fmtCost(logs.today.costUsd)}</span> });
    if (config.showTokens !== false) tickerParts.push({ key: "tokens", node: fmtTokens(logs.today.tokens) });
    if (config.showEnergy) tickerParts.push({ key: "energy", node: fmtEnergy(logs.today.energyKwh) });
  }
  return (
    <div className={pill}>
      <span className={logo}>✳</span>
      {logs.status === "ok" && tickerParts.length > 0 && (
        <span className={sub}>
          {tickerParts.map((p, i) => (
            <span key={p.key} style={{ display: "contents" }}>
              {i > 0 && " · "}
              {p.node}
            </span>
          ))}
        </span>
      )}
      {logs.status === "ok" && buckets.length > 0 && <span className={divider} />}
      {buckets.map((b) => (
        <Gauge key={b.id} label={b.label} pctUsed={b.pctUsed} resetsAt={b.resetsAt} />
      ))}
      {limits.stale && <span className={sub} style={{ opacity: 0.6 }}>cached</span>}
      {logs.status !== "ok" && limits.status !== "ok" && (
        <span className={sub}>claude-usage: no data ({logs.status}/{limits.status})</span>
      )}
    </div>
  );
};

const label = css`
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #8b90a0;
`;

const Ticker2Line = ({ logs, limits, config }) => {
  const buckets = (limits.status === "ok" ? limits.buckets : []).filter(
    (b) => config.showFable !== false || b.id !== "week_fable"
  );
  const todayParts = [];
  if (logs.status === "ok") {
    if (config.showCost) todayParts.push({ key: "cost", node: <span className={strong}>{fmtCost(logs.today.costUsd)}</span> });
    if (config.showTokens !== false) todayParts.push({ key: "tokens", node: `${fmtTokens(logs.today.tokens)} tok` });
    todayParts.push({ key: "sessions", node: `${logs.today.sessions} sessions` });
  }
  return (
    <div className={pill} style={{ flexDirection: "column", alignItems: "stretch", gap: 7, borderRadius: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span className={logo}>✳</span>
        {logs.status === "ok" && (
          <span className={sub}>
            Today{" "}
            {todayParts.map((p, i) => (
              <span key={p.key} style={{ display: "contents" }}>
                {p.node}
                {i < todayParts.length - 1 && " · "}
              </span>
            ))}
          </span>
        )}
        {logs.status === "ok" && (config.showCost || config.showEnergy) && (
          <span className={sub}>
            7d{" "}
            {config.showCost && <span className={strong}>{fmtCost(logs.week.costUsd)}</span>}
            {config.showCost && config.showEnergy && " · "}
            {config.showEnergy && fmtEnergy(logs.week.energyKwh)}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {buckets.map((b) => (
          <span key={b.id} className={sub}>
            <span className={label}>{b.label}</span> <span className={strong}>{b.pctUsed}%</span>
            <span className={barOuter} style={{ width: 64 }}>
              <span style={{ display: "block", height: "100%", borderRadius: 2,
                width: `${Math.min(b.pctUsed, 100)}%`, background: barColor(b.pctUsed) }} />
            </span>
            {fmtReset(b.resetsAt)}
          </span>
        ))}
        {limits.stale && <span className={sub} style={{ opacity: 0.6 }}>cached</span>}
      </div>
    </div>
  );
};

const Sparkline = ({ days, width = 7 * 9 }) => {
  const max = Math.max(...days.map((d) => d.tokens), 1);
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 22, width }}>
      {days.map((d) => (
        <span key={d.date} style={{
          flex: 1, borderRadius: "1.5px 1.5px 0 0",
          background: "rgba(217,119,87,0.75)",
          height: `${Math.max(8, (d.tokens / max) * 100)}%`,
        }} />
      ))}
    </span>
  );
};

const BarLayout = ({ logs, limits, config }) => {
  const buckets = (limits.status === "ok" ? limits.buckets : []).filter(
    (b) => config.showFable !== false || b.id !== "week_fable"
  );
  return (
    <div className={pill} style={{ padding: "10px 24px", borderRadius: 14, gap: 0 }}>
      {logs.status === "ok" && (
        <span style={{ display: "contents" }}>
          <span>
            <div className={label}>Today</div>
            <span className={strong} style={{ fontSize: 16 }}>{config.showCost ? fmtCost(logs.today.costUsd) : fmtTokens(logs.today.tokens)}</span>{" "}
            <span className={sub}>
              {joinParts([
                config.showTokens !== false && `${fmtTokens(logs.today.tokens)} tok`,
                `${logs.today.sessions} sess`,
                config.showEnergy && fmtEnergy(logs.today.energyKwh),
              ])}
            </span>
          </span>
          <span className={divider} style={{ margin: "0 18px" }} />
          <span>
            <div className={label}>7-day{config.showCost ? ` · ${fmtCost(logs.week.costUsd)}` : ""}</div>
            <Sparkline days={logs.week.days} width={7 * 11} />
          </span>
          {logs.models.length > 0 && (
            <span style={{ display: "contents" }}>
              <span className={divider} style={{ margin: "0 18px" }} />
              <span>
                <div className={label}>Models</div>
                <span className={sub}>
                  {logs.models.length === 1
                    ? logs.models[0].model.replace("claude-", "")
                    : logs.models.slice(0, 2).map((m, i) => {
                        const total = logs.models.reduce((a, x) => a + x.tokens, 0) || 1;
                        return (
                          <span key={m.model}>{i > 0 && " · "}{m.model.replace("claude-", "")}{" "}
                            <span className={strong}>{Math.round((m.tokens / total) * 100)}%</span>
                          </span>
                        );
                      })}
                </span>
              </span>
            </span>
          )}
          {buckets.length > 0 && <span className={divider} style={{ margin: "0 18px" }} />}
        </span>
      )}
      <span style={{ display: "flex", gap: 14 }}>
        {buckets.map((b) => (
          <span key={b.id}>
            <div className={label}>{b.label} · {fmtReset(b.resetsAt)}</div>
            <span className={barOuter} style={{ width: 90, margin: 0 }}>
              <span style={{ display: "block", height: "100%", borderRadius: 2,
                width: `${Math.min(b.pctUsed, 100)}%`, background: barColor(b.pctUsed) }} />
            </span>
          </span>
        ))}
        {limits.stale && <span className={sub} style={{ opacity: 0.6 }}>cached</span>}
      </span>
    </div>
  );
};

const CornerCard = ({ logs, limits, config }) => {
  const buckets = (limits.status === "ok" ? limits.buckets : []).filter(
    (b) => config.showFable !== false || b.id !== "week_fable"
  );
  return (
    <div className={pill} style={{ flexDirection: "column", alignItems: "stretch", gap: 6, borderRadius: 14, width: 210, padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className={label}><span className={logo}>✳</span> Claude</span>
        <span className={sub}>{new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>
      {logs.status === "ok" && (
        <span style={{ display: "contents" }}>
          <div>
            {config.showCost && <span className={strong} style={{ fontSize: 20 }}>{fmtCost(logs.today.costUsd)} </span>}
            <span className={sub}>
              {joinParts([
                config.showTokens !== false && `${fmtTokens(logs.today.tokens)} tok`,
                config.showEnergy && fmtEnergy(logs.today.energyKwh),
              ])}
            </span>
          </div>
          <Sparkline days={logs.week.days} width={178} />
        </span>
      )}
      {buckets.map((b) => (
        <div key={b.id}>
          <div className={label}>{b.label} {b.pctUsed}% · {fmtReset(b.resetsAt)}</div>
          <span className={barOuter} style={{ width: "100%", margin: 0 }}>
            <span style={{ display: "block", height: "100%", borderRadius: 2,
              width: `${Math.min(b.pctUsed, 100)}%`, background: barColor(b.pctUsed) }} />
          </span>
        </div>
      ))}
      {limits.stale && <span className={sub} style={{ opacity: 0.6 }}>cached</span>}
    </div>
  );
};

const Positioned = ({ align, scale = 1, bottom = 8, children }) => (
  // className anchors the widget at bottom: 8px; margin makes config.position.bottom effective
  <div style={{ display: "flex", width: "100%", justifyContent: alignToJustify(align), padding: "0 12px", marginBottom: bottom - 8 }}>
    <div style={{ zoom: scale }}>{children}</div>
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
  const bottom = (config.position && typeof config.position.bottom === "number") ? config.position.bottom : 8;
  const scale = config.scale || 1;
  const { logs, limits } = payload.providers.claude;
  // layout dispatch — more layouts added in Tasks 4 and 11
  const LAYOUTS = { ticker: Ticker, "ticker-2line": Ticker2Line, bar: BarLayout, corner: CornerCard };
  const Layout = LAYOUTS[config.layout] || Ticker;
  return (
    <Positioned align={align} scale={scale} bottom={bottom}>
      <Layout logs={logs} limits={limits} config={config} />
    </Positioned>
  );
};

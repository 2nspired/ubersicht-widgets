import { css } from "uebersicht";

export const command = "system.widget/lib/run.sh";
// Übersicht requires a static export; keep in sync with config.json refreshSeconds.
export const refreshFrequency = 3000;

export const className = `
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
`;

const TOKENS = [
  "text", "sub", "muted", "accent", "ok", "warn", "danger",
  "surface", "border", "shadow", "divider", "track", "radius",
];

// Object.assign, not spread — Übersicht's Babel does not support object spread.
const themeVars = (theme) => {
  const vars = {};
  if (!theme) return vars;
  for (let i = 0; i < TOKENS.length; i++) {
    const key = TOKENS[i];
    if (typeof theme[key] === "string") vars["--ub-" + key] = theme[key];
  }
  return vars;
};

const card = css`
  position: absolute;
  width: 300px;
  padding: 11px 14px;
  border-radius: var(--ub-radius, 12px);
  background: var(--ub-surface, linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92)));
  border: 1px solid var(--ub-border, rgba(255, 255, 255, 0.09));
  box-shadow: var(--ub-shadow, 0 8px 30px rgba(0, 0, 0, 0.45));
  color: var(--ub-text, #e8eaf0);
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.55;
  overflow: hidden;
`;

const pill = css`
  position: absolute;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 20px;
  border-radius: 999px;
  background: var(--ub-surface, linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92)));
  border: 1px solid var(--ub-border, rgba(255, 255, 255, 0.09));
  box-shadow: var(--ub-shadow, 0 8px 30px rgba(0, 0, 0, 0.45));
  color: var(--ub-text, #e8eaf0);
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;
const divider = css`
  width: 1px; align-self: stretch;
  background: var(--ub-divider, rgba(255, 255, 255, 0.1));
`;

const Sparkline = ({ history, width, height }) => {
  const p = streamPath(history, width, height);
  if (!p) return null;
  return (
    <svg width={width} height={height} style={{ flexShrink: 0 }}>
      <path d={p.line} style={{ fill: "none", stroke: "var(--ub-accent, #d97757)" }} strokeWidth="1.5" />
    </svg>
  );
};

const label = css`
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ub-muted, #8b90a0); font-weight: 600;
`;
const sub = css` color: var(--ub-sub, #9aa0b0); `;
const strong = css` color: var(--ub-text, #e8eaf0); font-weight: 600; `;
const rowCss = css`
  display: flex; align-items: center; gap: 6px;
  white-space: nowrap; position: relative;
`;
const nameCss = css` overflow: hidden; text-overflow: ellipsis; flex: 1; `;

export const fmtPercent = (n) => `${Math.round(n)}%`;
export const fmtBytes = (b) => {
  const gb = b / 1073741824;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(b / 1048576)} MB`;
};

// Severity uses the same thresholds as claude-usage's gauges.
const loadColor = (pct) =>
  pct >= 80 ? "var(--ub-danger, #d97757)"
    : pct >= 50 ? "var(--ub-warn, #d9a557)"
      : "var(--ub-ok, #5ba97f)";

// Builds an SVG area path from history. Points are spread across the full
// width regardless of how many samples exist, so a partly-filled ring still
// draws edge to edge instead of bunching on the left.
export const streamPath = (history, w, h) => {
  if (!history || history.length < 2) return null;
  const step = w / (history.length - 1);
  let line = "";
  for (let i = 0; i < history.length; i++) {
    const x = Math.round(i * step * 10) / 10;
    const y = Math.round((h - (Math.max(0, Math.min(100, history[i].cpu)) / 100) * h) * 10) / 10;
    line += (i === 0 ? "M" : " L") + x + "," + y;
  }
  return { line, area: line + ` L${w},${h} L0,${h} Z` };
};

const Stream = ({ history, width, height }) => {
  const p = streamPath(history, width, height);
  if (!p) return null;
  return (
    <svg
      width={width} height={height}
      style={{ position: "absolute", left: 0, bottom: 0, opacity: 0.5 }}
    >
      <path d={p.area} style={{ fill: "var(--ub-accent, #d97757)" }} opacity="0.22" />
      <path d={p.line} style={{ fill: "none", stroke: "var(--ub-accent, #d97757)" }} strokeWidth="1.4" opacity="0.75" />
    </svg>
  );
};

const Rows = ({ items, render }) => (
  <span style={{ display: "contents" }}>
    {items.map((g, i) => (
      <div className={rowCss} key={`${g.label}-${i}`}>{render(g)}</div>
    ))}
  </span>
);

const MemoryBar = ({ memory }) => {
  const t = memory.totalBytes || 1;
  const seg = (bytes, color) => (
    <span style={{ width: `${(bytes / t) * 100}%`, background: color, display: "block", height: "100%" }} />
  );
  return (
    <span style={{ display: "flex", height: 7, borderRadius: 3, overflow: "hidden", flex: 1 }}>
      {seg(memory.wiredBytes, "var(--ub-sub, #9aa0b0)")}
      {seg(memory.activeBytes, "var(--ub-ok, #5ba97f)")}
      {seg(memory.compressedBytes, "var(--ub-warn, #d9a557)")}
      {seg(memory.availableBytes, "var(--ub-track, rgba(255, 255, 255, 0.12))")}
    </span>
  );
};

const SpikeLine = ({ spike }) => {
  if (!spike) return null;
  const when = spike.active ? "ongoing" : `ended ${spike.endedSecondsAgo}s ago`;
  return (
    <div className={sub} style={{ fontSize: 9.5, marginBottom: 3 }}>
      peak <span className={strong} style={{ color: "var(--ub-warn, #d9a557)" }}>{spike.peak}%</span>
      {" · high for "}<span className={strong}>{spike.aboveSeconds}s</span>
      {" · "}{when}
    </div>
  );
};

const Ghost = ({ d }) => {
  const show = (d.config && d.config.show) || {};
  const showMemory = show.memory !== false;
  return (
    <span style={{ display: "contents" }}>
      <Stream history={d.history} width={300} height={112} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
          <span className={label}>System</span>
          <span className={sub}>
            CPU <span className={strong} style={{ color: loadColor(d.cpu.percent) }}>{fmtPercent(d.cpu.percent)}</span>
            {showMemory && <span style={{ display: "contents" }}>
              {" · MEM "}<span className={strong}>{fmtPercent(d.memory.usedPercent)}</span>
            </span>}
          </span>
        </div>
        <SpikeLine spike={d.spike} />
        <Rows
          items={d.cpu.top}
          render={(g) => (
            <span style={{ display: "contents" }}>
              <span style={{ color: loadColor(g.percent), fontSize: 8 }}>●</span>
              <span className={`${strong} ${nameCss}`}>{g.label}</span>
              {g.count > 1 && <span className={sub} style={{ fontSize: 9 }}>{g.count}</span>}
              <span className={sub}>{fmtPercent(g.percent)}</span>
            </span>
          )}
        />
        {d.gpu.visible && (
          <div className={rowCss} style={{ marginTop: 4 }}>
            <span className={label} style={{ flex: 1 }}>GPU</span>
            <span className={strong}>{fmtPercent(d.gpu.utilization)}</span>
          </div>
        )}
        {showMemory && (
          <span style={{ display: "contents" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7 }}>
              <span className={label}>Mem</span>
              <MemoryBar memory={d.memory} />
              <span className={sub}>
                <span className={strong}>{fmtBytes(d.memory.usedBytes)}</span>
                {"/"}{fmtBytes(d.memory.totalBytes)}
              </span>
            </div>
            {(d.memory.pressure === "warning" || d.memory.pressure === "critical") && (
              <span style={{ display: "contents" }}>
                <div className={label} style={{ marginTop: 5 }}>Top memory · {d.memory.pressure}</div>
                <Rows
                  items={d.memory.top}
                  render={(g) => (
                    <span style={{ display: "contents" }}>
                      <span className={`${strong} ${nameCss}`}>{g.label}</span>
                      <span className={sub}>{fmtBytes(g.rssKb * 1024)}</span>
                    </span>
                  )}
                />
              </span>
            )}
          </span>
        )}
      </div>
    </span>
  );
};

const Ticker = ({ d }) => {
  const config = d.config || {};
  const n = Math.min(typeof config.topN === "number" ? config.topN : 3, 2);
  const top = d.cpu.top.slice(0, n);
  const showMemory = ((config.show || {}).memory) !== false;
  return (
    <span style={{ display: "contents" }}>
      {d.history && d.history.length > 1 && (
        <Sparkline history={d.history} width={46} height={16} />
      )}
      <span className={sub}>
        CPU <span className={strong} style={{ color: loadColor(d.cpu.percent) }}>{fmtPercent(d.cpu.percent)}</span>
      </span>
      {d.spike && (
        <span className={sub} style={{ fontSize: 9.5 }}>
          peak <span className={strong} style={{ color: "var(--ub-warn, #d9a557)" }}>{d.spike.peak}%</span>
          {" · "}{d.spike.aboveSeconds}s
        </span>
      )}
      <span className={divider} />
      {top.map((g, i) => (
        <span className={sub} key={`${g.label}-${i}`}>
          <span style={{ color: loadColor(g.percent) }}>●</span>{" "}
          <span className={strong}>{g.label}</span> {fmtPercent(g.percent)}
        </span>
      ))}
      {d.gpu.visible && (
        <span style={{ display: "contents" }}>
          <span className={divider} />
          <span className={sub}>GPU <span className={strong}>{fmtPercent(d.gpu.utilization)}</span></span>
        </span>
      )}
      {showMemory && (
        <span style={{ display: "contents" }}>
          <span className={divider} />
          <span className={sub} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            MEM <span className={strong}>{fmtBytes(d.memory.usedBytes)}</span>
            <span style={{ display: "flex", width: 44 }}><MemoryBar memory={d.memory} /></span>
          </span>
        </span>
      )}
    </span>
  );
};

const cornerStyle = (corner, scale, offset) => {
  const [v, h] = String(corner || "top-right").split("-");
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
  return {
    [v === "bottom" ? "bottom" : "top"]: (8 + safeOffset) / scale,
    [h === "left" ? "left" : "right"]: 12 / scale,
  };
};

const LAYOUTS = { ghost: Ghost, ticker: Ticker };
// The ticker is a pill, not a card; the container differs per layout.
const CONTAINERS = { ghost: card, ticker: pill };

export const render = ({ output }) => {
  let d;
  try {
    d = JSON.parse(output);
  } catch {
    return null; // no empty chrome on the desktop
  }
  const config = d.config || {};
  const scale = typeof config.scale === "number" ? config.scale : 1;
  const style = cornerStyle(
    config.position && config.position.corner,
    scale,
    config.position && config.position.offset
  );
  style.zoom = scale;
  Object.assign(style, themeVars(d.theme));

  if (d.status === "error" || !d.cpu) {
    return <div className={card} style={style}><span className={sub}>system: unavailable</span></div>;
  }
  const name = LAYOUTS[config.layout] ? config.layout : "ghost";
  const Layout = LAYOUTS[name];
  return <div className={CONTAINERS[name]} style={style}><Layout d={d} /></div>;
};

export { themeVars, TOKENS, Stream, Rows, MemoryBar };

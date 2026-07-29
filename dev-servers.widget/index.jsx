import { css } from "uebersicht";

export const command = "dev-servers.widget/lib/run.sh";
// Übersicht requires a static export; keep in sync with config.json refreshSeconds.
export const refreshFrequency = 10000;

export const className = `
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
`;

const GREEN = "#5ba97f", AMBER = "#d9a557", GRAY = "#9aa0b0";

const card = css`
  position: absolute;
  min-width: 240px;
  max-width: 420px;
  padding: 10px 14px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92));
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  color: #e8eaf0;
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.7;
`;

const title = css`
  color: #9aa0b0;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 4px;
`;

const row = css`
  display: flex;
  align-items: baseline;
  gap: 7px;
  white-space: nowrap;
`;

const sub = css` color: #9aa0b0; `;
const strong = css` color: #e8eaf0; font-weight: 600; `;

// config.position.corner: "top-right" | "top-left" | "bottom-right" | "bottom-left"
// Insets match claude-usage (8px vertical, 12px horizontal). zoom multiplies the
// element's own offsets, so divide by scale to keep these physical pixels.
const cornerStyle = (corner, scale) => {
  const [v, h] = String(corner || "top-right").split("-");
  return {
    [v === "bottom" ? "bottom" : "top"]: 8 / scale,
    [h === "left" ? "left" : "right"]: 12 / scale,
  };
};

const DOT_COLOR = { up: GREEN, tcp: GRAY, down: AMBER, unknown: GRAY };

const Dot = ({ health }) => (
  <span style={{ color: DOT_COLOR[health] || GRAY, fontSize: 8 }}>
    {health === "tcp" ? "◉" : "●"}
  </span>
);

const Row = ({ s, show }) => (
  <div className={row}>
    {show.health && <Dot health={s.health} />}
    <span className={strong}>{s.project || s.name || s.command}</span>
    <span className={sub}>
      {s.port != null ? `:${s.port}` : "→ ☁"}
      {s.ports.length > 1 && ` +${s.ports.length - 1}`}
    </span>
    {(s.project || s.name) && <span className={sub}>{s.command}</span>}
    {show.branch && s.branch && <span className={sub}>⎇ {s.branch}</span>}
    {show.uptime && s.age && (
      <span style={{ color: s.stale ? AMBER : "#9aa0b0" }}>{s.age}</span>
    )}
    {show.cpu && s.cpu != null && <span className={sub}>{Math.round(s.cpu)}%</span>}
    {show.mem && s.memMb != null && <span className={sub}>{s.memMb}MB</span>}
  </div>
);

export const render = ({ output }) => {
  let data;
  try {
    data = JSON.parse(output);
  } catch {
    return null;
  }
  const config = data.config || {};
  const show = config.show || {};
  const scale = typeof config.scale === "number" ? config.scale : 1;
  const style = cornerStyle(config.position && config.position.corner, scale);
  style.zoom = scale; // cornerStyle returns a fresh object; avoid object spread (Übersicht Babel)

  if (data.status === "error") {
    return (
      <div className={card} style={style}>
        <span className={sub}>servers: scan failed</span>
      </div>
    );
  }

  const servers = data.servers || [];
  if (servers.length === 0) return null; // no empty chrome on the desktop

  const max = Number.isInteger(config.maxRows) ? config.maxRows : 12;
  const shown = servers.slice(0, max);
  const hidden = servers.length - shown.length;

  return (
    <div className={card} style={style}>
      <div className={title}>Servers</div>
      {shown.map((s, i) => (
        <Row key={`${s.pid || s.name || i}-${s.port || i}`} s={s} show={show} />
      ))}
      {hidden > 0 && <div className={sub}>+{hidden} more</div>}
    </div>
  );
};

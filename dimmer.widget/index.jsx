import { css } from "uebersicht";

// No collector, no Node: this widget has no data to gather — its config
// *is* its output. Running a script every refresh to produce the same
// constant payload would be pure waste, so `cat` reads config.json directly.
//
// Übersicht runs `command` from its widgets directory, and this widget is
// symlinked in as `dimmer.widget` (see README "Install"), so the relative
// path below resolves the same way the sibling widgets' lib/run.sh scripts
// locate themselves relative to the widgets directory.
export const command = "cat dimmer.widget/config.json";

// Config edits apply within one refresh cycle.
export const refreshFrequency = 10000;

const DEFAULTS = {
  amount: 0.2,
  color: "0, 0, 0",
  filter: null,
};

const isFiniteNumber = (n) => typeof n === "number" && isFinite(n);

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));

// amount: clamp to [0, 1]; reject NaN/Infinity/non-numbers by falling back.
const sanitizeAmount = (amount) => {
  if (!isFiniteNumber(amount)) return DEFAULTS.amount;
  return clamp01(amount);
};

// color: an "r, g, b" triple string. Anything that doesn't parse to exactly
// three finite numbers falls back to the default black wash; each channel
// is clamped to a valid byte.
const sanitizeColor = (color) => {
  if (typeof color !== "string") return DEFAULTS.color;
  const parts = color.split(",").map((part) => parseFloat(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !isFiniteNumber(part))) {
    return DEFAULTS.color;
  }
  return parts.map(clampByte).join(", ");
};

// filter: a raw CSS filter string, or null/absent to skip backdrop-filter
// entirely. Anything that isn't a non-empty string is treated as "off".
const sanitizeFilter = (filter) => {
  if (typeof filter !== "string") return null;
  const trimmed = filter.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeConfig = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    amount: sanitizeAmount(source.amount),
    color: sanitizeColor(source.color),
    filter: sanitizeFilter(source.filter),
  };
};

// Parse failures, a missing config, or nonsense values must never throw —
// they fall back to DEFAULTS instead.
const parseConfig = (output) => {
  let raw;
  try {
    raw = JSON.parse(output);
  } catch (e) {
    raw = null;
  }
  return sanitizeConfig(raw);
};

// z-index: -1 so the sibling widgets in Übersicht's shared document paint
// above this one — all Übersicht widgets render into one DOM document,
// which is what keeps claude-usage/dev-servers/system unaffected regardless
// of this widget's own window layer.
//
// pointer-events: none is defence in depth. It isn't what makes clicks safe
// — Finder's desktop window sits physically above Übersicht's background
// layer, so desktop clicks can't reach this element either way — but it
// costs nothing and documents the intent.
const overlay = css`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: -1;
  pointer-events: none;
`;

export const render = ({ output }) => {
  let config;
  try {
    config = parseConfig(output);
  } catch (e) {
    config = DEFAULTS;
  }

  // Composition: the flat rgba() wash is the primary effect and is always
  // applied (it's what "darken by 10%" means). backdrop-filter, when set,
  // is layered on top as an additive escape hatch for blur/desaturate —
  // it does not replace the wash, since amount:0 plus a filter with no wash
  // would leave "darken" undocumented and surprising. Both are cheap
  // together since the overlay already has no content to composite wrong.
  const style = {
    background: "rgba(" + config.color + ", " + config.amount + ")",
  };
  if (config.filter) {
    style.backdropFilter = config.filter;
    style.WebkitBackdropFilter = config.filter;
  }

  return <div className={overlay} style={style} />;
};

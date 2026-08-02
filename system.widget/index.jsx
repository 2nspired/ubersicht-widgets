import { css } from "uebersicht";

export const command = "system.widget/lib/run.sh";
// Übersicht requires a static export; keep in sync with config.json refreshSeconds.
export const refreshFrequency = 3000;

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

// Placeholder chrome class; Task 7 wires this into the real layout. Kept here
// (rather than omitted) so the widget already exercises a themed CSS custom
// property with a fallback matching lib/theme.js's MIDNIGHT, satisfying the
// theme drift test.
const container = css({
  background: "var(--ub-surface, linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92)))",
});

// Placeholder until Task 7 — renders nothing rather than empty chrome.
export const render = () => null;

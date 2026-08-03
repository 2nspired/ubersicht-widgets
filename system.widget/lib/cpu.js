"use strict";

// A wall-clock gap larger than this means the machine slept or refreshes were
// missed. Deltas across such a gap are meaningless, so the caller skips them.
const DISCONTINUITY_SECONDS = 30;

// macOS `ps -o time=` emits MINUTES:SECONDS.HUNDREDTHS with UNBOUNDED minutes
// (WindowServer reads "896:38.07"), not HH:MM:SS. The three-field branch is
// defensive only.
function parseCpuTime(str) {
  const s = String(str == null ? "" : str).trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.length === 2
    ? nums[0] * 60 + nums[1]
    : nums[0] * 3600 + nums[1] * 60 + nums[2];
}

// Parses `ps -axo pid=,time=,rss=,comm=`. Only the first three columns are
// whitespace-delimited; the command path is the rest of the line and may
// contain spaces ("Some App.app"), so it is never split.
function parsePsSample(text) {
  const out = new Map();
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const cpuSeconds = parseCpuTime(m[2]);
    const rssKb = parseInt(m[3], 10);
    if (!Number.isInteger(pid) || cpuSeconds == null) continue;
    out.set(pid, { cpuSeconds, rssKb: Number.isInteger(rssKb) ? rssKb : 0, comm: m[4] });
  }
  return out;
}

// Per-core percentage, matching Activity Monitor's convention: a process using
// two cores fully reads 200%.
function computeDeltas(prev, curr, elapsedSeconds) {
  const out = new Map();
  if (!(elapsedSeconds > 0)) return out;
  for (const [pid, now] of curr) {
    const before = prev.get(pid);
    if (!before) continue;
    // A recycled pid can carry a different executable, or a lower cpu time
    // than the process that held the pid before it.
    if (before.comm !== now.comm) continue;
    const delta = now.cpuSeconds - before.cpuSeconds;
    if (!(delta >= 0)) continue;
    out.set(pid, (delta / elapsedSeconds) * 100);
  }
  return out;
}

// Executables that are worth labelling by project rather than collapsing:
// "node 71%" is useless on a machine running thirteen of them.
const DEV_BINARIES = new Set([
  "node", "deno", "bun", "ruby", "go", "cargo", "rustc", "java",
]);

function isDevBinary(base) {
  return DEV_BINARIES.has(base) || /^python[\d.]*$/.test(base);
}

// macOS helper processes live in NESTED .app bundles, e.g.
//   /Applications/Obsidian.app/.../Obsidian Helper (GPU).app/Contents/MacOS/...
// The first bundle is the owning application; the last is the helper.
function bundleName(commPath) {
  const parts = String(commPath || "").split("/");
  for (const part of parts) {
    if (part.endsWith(".app")) return part.slice(0, -4);
  }
  return null;
}

function classify(comm) {
  const app = bundleName(comm);
  if (app) return { kind: "app", label: app };
  const base = String(comm || "").split("/").pop() || "";
  if (isDevBinary(base)) return { kind: "dev", label: base };
  return { kind: "exe", label: base };
}

// projectByPid maps a pid to a project name; only dev-kind processes consult it.
function groupProcesses(samples, percents, projectByPid) {
  const byLabel = new Map();
  for (const [pid, sample] of samples) {
    const { kind, label: base } = classify(sample.comm);
    const project = kind === "dev" ? projectByPid.get(pid) : null;
    const label = project ? `${base} · ${project}` : base;
    if (!label) continue;

    let row = byLabel.get(label);
    if (!row) {
      row = { label, kind, percent: 0, rssKb: 0, count: 0 };
      byLabel.set(label, row);
    }
    row.percent += percents.get(pid) || 0;
    row.rssKb += sample.rssKb || 0;
    row.count += 1;
  }
  return [...byLabel.values()].sort((a, b) => b.percent - a.percent);
}

function topBy(groups, field, n) {
  return [...groups].sort((a, b) => b[field] - a[field]).slice(0, n);
}

// Exclude the collector's own process before grouping: once groupProcesses
// has collapsed samples into labelled rows the pid is gone, and label-based
// exclusion cannot distinguish "the collector, briefly, this refresh" from
// "the user's own long-running node process" — both would classify as a
// bare "node" row. PID is precise and can never collide with real work.
// Pure: returns a new Map, leaving the caller's samples untouched.
function excludeSelf(samples, selfPid) {
  const out = new Map(samples);
  out.delete(selfPid);
  return out;
}

// True when a group should be hidden as "this is Übersicht itself", not the
// user's own work. Dev-kind groups are never hidden by label — a
// project-less `node` process is exactly what this widget exists to surface.
// Labels are compared after Unicode NFC normalization on both sides: macOS
// `ps` can emit an accented bundle name (e.g. Übersicht.app) in NFD —
// decomposed "U" + U+0308 COMBINING DIAERESIS — while a source string
// literal for the same name is ordinarily NFC (precomposed U+00DC).
// Set.has() does no normalization of its own, so comparing raw strings
// silently fails whenever the two representations disagree.
function isSelfGroup(group, selfLabels) {
  if (group.kind === "dev") return false;
  return selfLabels.has(String(group.label || "").normalize("NFC"));
}

module.exports = {
  parseCpuTime, parsePsSample, computeDeltas, DISCONTINUITY_SECONDS,
  DEV_BINARIES, bundleName, classify, groupProcesses, topBy,
  excludeSelf, isSelfGroup,
};

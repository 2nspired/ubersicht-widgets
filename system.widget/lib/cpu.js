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

module.exports = { parseCpuTime, parsePsSample, computeDeltas, DISCONTINUITY_SECONDS };

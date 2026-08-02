"use strict";
const { DISCONTINUITY_SECONDS } = require("./cpu");

// Trim by timestamp rather than by count. After the machine sleeps, a
// count-based cap would retain ancient samples and draw a line across the gap.
function trimHistory(entries, nowMs, windowMs) {
  if (!Array.isArray(entries)) return [];
  const cutoff = nowMs - windowMs;
  return entries.filter((e) => e && typeof e.t === "number" && e.t > cutoff);
}

function appendSample(entries, sample, windowMs) {
  const next = Array.isArray(entries) ? entries.concat([sample]) : [sample];
  return trimHistory(next, sample.t, windowMs);
}

function isDiscontinuity(prevMs, nowMs) {
  if (prevMs == null) return true;
  return nowMs - prevMs > DISCONTINUITY_SECONDS * 1000;
}

// A spike is cumulative time at or above `percent` reaching `seconds` within
// the window. Each sample represents the interval since the previous one, so
// duration is measured from timestamps rather than assuming a fixed cadence —
// refreshes are not perfectly spaced.
function detectSpike(entries, { percent, seconds }, nowMs) {
  if (!Array.isArray(entries) || entries.length < 2) return null;

  let peak = 0;
  for (const e of entries) {
    if (typeof e.cpu === "number" && e.cpu > peak) peak = e.cpu;
  }

  const isValidGap = (gap) => gap > 0 && gap <= DISCONTINUITY_SECONDS * 1000;

  // Each sample covers the physical interval since the previous one: an
  // above-threshold reading at `cur` credits the real elapsed gap
  // [prev.t, cur.t]. The oldest sample in the window credits nothing — we
  // genuinely don't know what the machine was doing before the window
  // opened. Walking consecutive pairs this way credits every interval
  // exactly once (no double-counting at the start of the array), which
  // also makes aboveSeconds mathematically incapable of exceeding the
  // window's elapsed span. Samples are irregularly spaced, so real
  // timestamps drive the duration rather than an assumed cadence, and
  // non-contiguous above-threshold readings still accumulate toward the
  // same total.
  let aboveMs = 0;
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (typeof cur.cpu !== "number" || cur.cpu < percent) continue;
    const gap = cur.t - prev.t;
    if (isValidGap(gap)) aboveMs += gap;
  }

  if (aboveMs < seconds * 1000) return null;

  // The spike "ends" at the first reading that comes back down after an
  // above-threshold reading — the earliest evidence we have that it ended,
  // even though the exact moment between the two samples is unknown. A
  // sleep gap must never be credited here either, so it uses the same
  // validity check as aboveMs.
  let lastAboveT = null;
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    if (typeof prev.cpu === "number" && prev.cpu >= percent && isValidGap(entries[i].t - prev.t)) {
      lastAboveT = entries[i].t;
    }
  }

  const last = entries[entries.length - 1];
  const active = typeof last.cpu === "number" && last.cpu >= percent;
  return {
    peak: Math.round(peak),
    aboveSeconds: Math.round(aboveMs / 1000),
    active,
    endedSecondsAgo: active ? 0 : Math.max(0, Math.round((nowMs - lastAboveT) / 1000)),
  };
}

module.exports = { trimHistory, appendSample, isDiscontinuity, detectSpike };

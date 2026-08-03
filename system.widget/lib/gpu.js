"use strict";

// ioreg -r -d 1 -w 0 -c IOAccelerator exposes a PerformanceStatistics dict:
//   "Device Utilization %"=11,"Alloc system memory"=4959191040,...
// No elevated privileges needed. Per-process GPU is NOT available here —
// powermetrics is the only source and it requires root.
function pick(text, key, { max = false } = {}) {
  const re = new RegExp('"' + key + '"=(\\d+)', "g");
  let m;
  let best = null;
  while ((m = re.exec(text)) !== null) {
    const v = parseInt(m[1], 10);
    if (!Number.isFinite(v)) continue;
    best = best == null ? v : max ? Math.max(best, v) : best;
  }
  return best;
}

function parseIoreg(text) {
  const s = String(text || "");
  return {
    // A machine can expose more than one accelerator; the busiest is the
    // honest answer to "is the GPU working right now".
    utilization: pick(s, "Device Utilization %", { max: true }),
    allocBytes: pick(s, "Alloc system memory"),
    inUseBytes: pick(s, "In use system memory"),
  };
}

module.exports = { parseIoreg };

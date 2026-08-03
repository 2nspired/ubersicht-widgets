"use strict";

// kern.memorystatus_vm_pressure_level. Pressure — not percentage full — is the
// honest signal: this machine sits at 60% "used" while entirely healthy.
const PRESSURE = { 1: "normal", 2: "warning", 4: "critical" };

const COUNTERS = {
  free: /^Pages free:\s+(\d+)/m,
  active: /^Pages active:\s+(\d+)/m,
  inactive: /^Pages inactive:\s+(\d+)/m,
  speculative: /^Pages speculative:\s+(\d+)/m,
  wired: /^Pages wired down:\s+(\d+)/m,
  compressor: /^Pages occupied by compressor:\s+(\d+)/m,
};

function parseVmStat(text) {
  const s = String(text || "");
  const pageMatch = s.match(/page size of (\d+) bytes/);
  const out = { pageSize: pageMatch ? parseInt(pageMatch[1], 10) : 4096 };
  for (const key of Object.keys(COUNTERS)) {
    const m = s.match(COUNTERS[key]);
    out[key] = m ? parseInt(m[1], 10) : 0;
  }
  return out;
}

// `sysctl -n vm.swapusage` -> "total = 2048.00M  used = 512.50M  free = ..."
function parseSwapUsed(text) {
  const m = String(text || "").match(/used\s*=\s*([\d.]+)M/);
  return m ? Math.round(parseFloat(m[1]) * 1024 * 1024) : 0;
}

function buildMemory({ vmStat, totalBytes, pressureLevel, swapUsedBytes }) {
  const p = vmStat.pageSize;
  const wiredBytes = vmStat.wired * p;
  const activeBytes = vmStat.active * p;
  const compressedBytes = vmStat.compressor * p;
  // macOS can reclaim inactive and speculative pages on demand, so they count
  // as available rather than used — this is what Activity Monitor does too.
  const availableBytes = (vmStat.free + vmStat.inactive + vmStat.speculative) * p;
  const usedBytes = wiredBytes + activeBytes + compressedBytes;
  return {
    totalBytes,
    wiredBytes,
    activeBytes,
    compressedBytes,
    availableBytes,
    usedBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
    pressure: PRESSURE[pressureLevel] || "unknown",
    swapUsedBytes: swapUsedBytes || 0,
  };
}

module.exports = { parseVmStat, parseSwapUsed, buildMemory, PRESSURE };

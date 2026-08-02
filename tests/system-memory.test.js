"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const mem = require("../system.widget/lib/memory.js");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "vm-stat.txt"), "utf8");

test("parseVmStat reads the page size from the header, never hardcoded", () => {
  const v = mem.parseVmStat(FIXTURE);
  assert.equal(v.pageSize, 16384);
  // A machine with 4096-byte pages must parse as 4096.
  const alt = mem.parseVmStat("Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 10.\n");
  assert.equal(alt.pageSize, 4096);
});

test("parseVmStat extracts every segment counter", () => {
  const v = mem.parseVmStat(FIXTURE);
  for (const k of ["free", "active", "inactive", "speculative", "wired", "compressor"]) {
    assert.equal(typeof v[k], "number", `${k} missing`);
    assert.ok(v[k] >= 0, `${k} negative`);
  }
  assert.ok(v.active > 0);
});

test("parseVmStat tolerates missing lines without throwing", () => {
  const v = mem.parseVmStat("Mach Virtual Memory Statistics: (page size of 16384 bytes)\n");
  assert.equal(v.active, 0);
  assert.equal(v.pageSize, 16384);
});

test("buildMemory sums the four segments to the machine total", () => {
  const vmStat = { pageSize: 16384, free: 100, active: 200, inactive: 300,
                   speculative: 50, wired: 80, compressor: 40 };
  const totalBytes = (100 + 200 + 300 + 50 + 80 + 40) * 16384;
  const m = mem.buildMemory({ vmStat, totalBytes, pressureLevel: 1, swapUsedBytes: 0 });

  assert.equal(m.wiredBytes, 80 * 16384);
  assert.equal(m.activeBytes, 200 * 16384);
  assert.equal(m.compressedBytes, 40 * 16384);
  // available = free + inactive + speculative, the pages macOS can reclaim
  assert.equal(m.availableBytes, (100 + 300 + 50) * 16384);
  assert.equal(m.wiredBytes + m.activeBytes + m.compressedBytes + m.availableBytes, totalBytes);
});

test("buildMemory maps pressure levels to names", () => {
  const vmStat = { pageSize: 16384, free: 1, active: 1, inactive: 1, speculative: 1, wired: 1, compressor: 1 };
  const at = (lvl) => mem.buildMemory({ vmStat, totalBytes: 6 * 16384, pressureLevel: lvl, swapUsedBytes: 0 }).pressure;
  assert.equal(at(1), "normal");
  assert.equal(at(2), "warning");
  assert.equal(at(4), "critical");
  assert.equal(at(null), "unknown");
  assert.equal(at(99), "unknown");
});

test("buildMemory computes usedPercent excluding reclaimable pages", () => {
  const vmStat = { pageSize: 16384, free: 500, active: 300, inactive: 0,
                   speculative: 0, wired: 100, compressor: 100 };
  const m = mem.buildMemory({ vmStat, totalBytes: 1000 * 16384, pressureLevel: 1, swapUsedBytes: 0 });
  assert.equal(m.usedPercent, 50); // (300+100+100)/1000
});

test("parseSwapUsed reads megabytes from vm.swapusage", () => {
  assert.equal(mem.parseSwapUsed("total = 2048.00M  used = 512.50M  free = 1535.50M  (encrypted)"),
    Math.round(512.5 * 1024 * 1024));
  assert.equal(mem.parseSwapUsed("total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)"), 0);
  assert.equal(mem.parseSwapUsed("garbage"), 0);
});

"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const COLLECT = path.join(__dirname, "..", "system.widget", "lib", "collect.js");

// Each run gets its own cache so the two runs below are genuinely
// first-run and second-run, independent of the developer's real cache.
function run(args, cacheDir) {
  const out = execFileSync(process.execPath, [COLLECT].concat(args || []), {
    encoding: "utf8",
    env: Object.assign({}, process.env, { UBERSICHT_SYSTEM_WIDGET_CACHE: cacheDir }),
  });
  return JSON.parse(out);
}

function tmpCache() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sysw-")), "history.json");
}

test("collector emits valid JSON with the full payload shape", () => {
  const d = run([], tmpCache());
  assert.equal(d.status, "ok");
  assert.equal(typeof d.generatedAt, "string");
  assert.ok(d.cpu && typeof d.cpu.percent === "number");
  assert.ok(d.cpu.percent >= 0 && d.cpu.percent <= 100, "headline CPU is normalised 0-100");
  assert.ok(Array.isArray(d.cpu.top));
  assert.ok(d.memory && d.memory.totalBytes > 0);
  assert.ok(["normal", "warning", "critical", "unknown"].includes(d.memory.pressure));
  assert.ok(Array.isArray(d.memory.top));
  assert.ok(d.gpu && typeof d.gpu.visible === "boolean");
  assert.ok(Array.isArray(d.history));
});

test("collector emits a full 13-token theme on the success path", () => {
  const d = run([], tmpCache());
  assert.equal(Object.keys(d.theme).length, 13);
  for (const v of Object.values(d.theme)) assert.equal(typeof v, "string");
  assert.ok("themeError" in d);
});

test("first run flags cpuEstimated, second run does not", () => {
  const cache = tmpCache();
  const first = run([], cache);
  assert.equal(first.cpuEstimated, true, "no prior sample means no delta is possible");
  const second = run([], cache);
  assert.equal(second.cpuEstimated, false);
  assert.ok(second.history.length >= 1);
});

test("mock mode renders without touching the live system", () => {
  const d = run(["--mock"], tmpCache());
  assert.equal(d.status, "ok");
  assert.ok(d.cpu.top.length > 0);
  assert.equal(Object.keys(d.theme).length, 13);
});

test("group percentages are per-core and may exceed the headline", () => {
  const d = run(["--mock"], tmpCache());
  // Documented unit split: headline normalised, per-group per-core.
  assert.ok(d.cpu.top.every((g) => typeof g.percent === "number"));
  assert.equal(typeof d.cpu.cores, "number");
  assert.ok(d.cpu.cores > 0);
});

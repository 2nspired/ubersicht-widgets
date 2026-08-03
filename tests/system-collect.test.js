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

// A malformed-but-valid-JSON cache (e.g. hand-edited, or from an incompatible
// future/older format) must not brick the widget. Before this fix,
// `cache.sample.map(...)` in collect.js threw when `sample` was not an array,
// and because the throw happened before writeCache ran, the bad cache file
// was never replaced — the widget stayed broken until someone deleted it by
// hand. See spec: "A missing, unreadable, or malformed cache is treated as a
// first run, not an error."
test("a cache with a malformed (non-array) sample degrades to first-run, not an error", () => {
  const cache = tmpCache();
  fs.writeFileSync(cache, JSON.stringify({ sample: {}, at: Date.now(), history: [] }));
  const d = run([], cache);
  assert.equal(d.status, "ok");
  assert.equal(d.cpuEstimated, true, "malformed sample must fall through to the estimated first-run path");
});

// Deliberately removed: a prior "Übersicht never appears in cpu.top" test was
// proven vacuous by mutation two different ways — removing the label filter
// entirely, and removing excludeSelf from collect.js — both left the suite
// green, because Übersicht ranks far outside the top 3 on an idle dev machine
// regardless of whether the filter runs. The real coverage for self-exclusion
// is tests/system-cpu.test.js's direct unit tests of excludeSelf and
// isSelfGroup, which were confirmed to go red under the same mutations.

// readConfig() in collect.js resolves `../config.json` relative to lib/, so a
// temp widget directory with its own lib/ + config.json lets us drive the
// collector's config-consuming orchestration lines with values distinct from
// every default, instead of relying on the shipped config.json (whose values
// happen to equal the defaults and so cannot distinguish "config honoured"
// from "config ignored").
function makeTempWidgetDir(configOverrides) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sysw-cfg-"));
  const lib = path.join(root, "lib");
  fs.cpSync(path.join(__dirname, "..", "system.widget", "lib"), lib, { recursive: true });
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(configOverrides));
  return { root, lib };
}

test("config values (topN, show.history, gpuThreshold) actually drive the collector, not hardcoded defaults", () => {
  // Each override is chosen to differ observably from what a hardcoded stand-in
  // would produce on a real, busy-enough dev machine:
  //  - topN: 1 vs. a hardcoded 3 — any real machine has well over 3 distinct
  //    process groups, so a hardcoded 3 would yield a 3-entry (or longer,
  //    pre-slice) list instead of 1.
  //  - show.history: false vs. a hardcoded `true` branch — the ring would be
  //    non-empty instead of suppressed.
  //  - gpuThreshold: 101 — deliberately unreachable (utilization is a 0-100
  //    percentage), so a working `>= CONFIG.gpuThreshold` comparison always
  //    yields `visible: false`. This is chosen instead of the more obvious
  //    `gpuThreshold: 0`: with 0, "dropping the >= comparison" and "keeping
  //    it" produce the *same* result, because ioreg's utilization is parsed
  //    as `\d+` and can never be negative — `x >= 0` is a tautology for any
  //    number, so a threshold of 0 cannot distinguish the check existing from
  //    the check being deleted. 101 can, and does so unconditionally,
  //    regardless of whether this machine has a GPU accelerator to report on
  //    (typeof-number check already yields false when there is none).
  const { lib } = makeTempWidgetDir({ topN: 1, show: { history: false }, gpuThreshold: 101 });
  const out = execFileSync(process.execPath, [path.join(lib, "collect.js")], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { UBERSICHT_SYSTEM_WIDGET_CACHE: tmpCache() }),
  });
  const d = JSON.parse(out);

  assert.equal(d.status, "ok");
  assert.equal(d.config.topN, 1, "sanity: the temp config.json was actually read");

  assert.equal(d.cpu.top.length, 1, "topN: 1 must cap the list at 1, not a hardcoded 3");
  assert.equal(d.history.length, 0, "show.history: false must suppress the ring, not be ignored");
  assert.equal(d.spike, null, "spike detection needs history and must not run when history is suppressed");
  assert.equal(d.gpu.visible, false, "gpuThreshold: 101 is unreachable, so gpu.visible must be false");

  // Fourth mutant (dropping "/ cores" from the headline calc): NOT checked
  // here. It was previously asserted as `d.cpu.percent < 100` against the
  // live machine's real process table, but that only goes red when the
  // uncontrolled `ps` snapshot happens to sum to over 100 across cores at the
  // instant this test runs — on a lightly-loaded machine (the common case)
  // the assertion is a no-op that passes under the mutant too. An independent
  // reviewer ran the mutation 8/8 green. This sanity check only confirms the
  // headline is a valid percentage at all; the actual "/ cores" division is
  // covered deterministically, with fixed inputs, by
  // tests/system-cpu.test.js's `normalizeHeadline` tests.
  assert.ok(d.cpu.cores > 1, "expected a multi-core machine for this check to be meaningful");
  assert.ok(d.cpu.percent >= 0 && d.cpu.percent <= 100, "headline stays a valid percentage");
});

// position.offset lets system.widget stack above another corner-anchored
// widget (e.g. dev-servers, also bottom-left). readConfig()'s merge used to
// spread `...user` wholesale over `...DEFAULTS`, so a user config supplying
// only `position.corner` replaced the whole `position` object and silently
// dropped the `offset` default (and vice versa for a config supplying only
// `position.offset`). These assert the merged, emitted config.position
// always carries both keys.
function runWithConfig(configOverrides) {
  const { lib } = makeTempWidgetDir(configOverrides);
  const out = execFileSync(process.execPath, [path.join(lib, "collect.js")], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { UBERSICHT_SYSTEM_WIDGET_CACHE: tmpCache() }),
  });
  return JSON.parse(out);
}

test("position.offset is carried through when explicitly set alongside corner", () => {
  const d = runWithConfig({ position: { corner: "bottom-left", offset: 150 } });
  assert.equal(d.config.position.corner, "bottom-left");
  assert.equal(d.config.position.offset, 150);
});

test("position.offset defaults to 0 when position is omitted entirely", () => {
  const d = runWithConfig({});
  assert.equal(d.config.position.corner, "top-right");
  assert.equal(d.config.position.offset, 0);
});

test("a user config supplying only position.corner does not drop the position.offset default", () => {
  const d = runWithConfig({ position: { corner: "bottom-left" } });
  assert.equal(d.config.position.corner, "bottom-left");
  assert.equal(d.config.position.offset, 0, "offset default must survive a partial position override");
});

test("a user config supplying only position.offset does not drop the position.corner default", () => {
  const d = runWithConfig({ position: { offset: 42 } });
  assert.equal(d.config.position.offset, 42);
  assert.equal(d.config.position.corner, "top-right", "corner default must survive a partial position override");
});


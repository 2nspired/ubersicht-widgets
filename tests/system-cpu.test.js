"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const cpu = require("../system.widget/lib/cpu.js");

test("parseCpuTime handles macOS unbounded-minutes format", () => {
  // macOS ps emits MINUTES:SECONDS.HUNDREDTHS with minutes unbounded —
  // WindowServer really does read 896:38.07, not 14:56:38.
  assert.equal(cpu.parseCpuTime("896:38.07"), 896 * 60 + 38.07);
  assert.equal(cpu.parseCpuTime("0:00.50"), 0.5);
  assert.equal(cpu.parseCpuTime("2:06.04"), 126.04);
});

test("parseCpuTime defensively accepts a three-field form", () => {
  assert.equal(cpu.parseCpuTime("1:02:03"), 3723);
});

test("parseCpuTime returns null on garbage", () => {
  assert.equal(cpu.parseCpuTime("nonsense"), null);
  assert.equal(cpu.parseCpuTime(""), null);
  assert.equal(cpu.parseCpuTime(null), null);
});

test("parsePsSample reads pid, cpu time, rss and full command path", () => {
  const text = fs.readFileSync(
    path.join(__dirname, "fixtures", "ps-sample.txt"), "utf8");
  const map = cpu.parsePsSample(text);
  assert.ok(map.size > 5);
  const obsidian = map.get(357);
  assert.equal(obsidian.cpuSeconds, 126.04);
  assert.equal(obsidian.rssKb, 83440);
  assert.ok(obsidian.comm.endsWith("Obsidian Helper (GPU)"));
});

test("parsePsSample keeps spaces in command paths", () => {
  const map = cpu.parsePsSample("  357   2:06.04  83440 /App/Some App.app/Contents/MacOS/Some App\n");
  assert.equal(map.get(357).comm, "/App/Some App.app/Contents/MacOS/Some App");
});

test("computeDeltas converts cpu-second growth into per-core percent", () => {
  const prev = new Map([[1, { cpuSeconds: 100, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 103, comm: "/bin/a" }]]);
  // 3 cpu-seconds over 3 wall-seconds = one core fully busy = 100%
  assert.equal(cpu.computeDeltas(prev, curr, 3).get(1), 100);
});

test("computeDeltas reports above 100% for multi-threaded processes", () => {
  const prev = new Map([[1, { cpuSeconds: 0, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 6, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).get(1), 200);
});

test("computeDeltas drops negative deltas from recycled pids", () => {
  const prev = new Map([[1, { cpuSeconds: 500, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 2, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).has(1), false);
});

test("computeDeltas drops a pid whose comm changed — pid reuse", () => {
  const prev = new Map([[1, { cpuSeconds: 10, comm: "/bin/old" }]]);
  const curr = new Map([[1, { cpuSeconds: 12, comm: "/bin/new" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).has(1), false);
});

test("computeDeltas omits pids absent from the previous sample", () => {
  const prev = new Map();
  const curr = new Map([[1, { cpuSeconds: 5, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).size, 0);
});

test("computeDeltas returns empty for a non-positive window", () => {
  const prev = new Map([[1, { cpuSeconds: 1, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 2, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 0).size, 0);
  assert.equal(cpu.computeDeltas(prev, curr, -5).size, 0);
});

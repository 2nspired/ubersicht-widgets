"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const gpu = require("../system.widget/lib/gpu.js");

test("parseIoreg reads Device Utilization from real ioreg output", () => {
  const text = fs.readFileSync(path.join(__dirname, "fixtures", "ioreg-accel.txt"), "utf8");
  const g = gpu.parseIoreg(text);
  assert.equal(typeof g.utilization, "number");
  assert.ok(g.utilization >= 0 && g.utilization <= 100);
});

test("parseIoreg takes the maximum across multiple accelerators", () => {
  // Descending order on purpose: with ascending values a "take the last
  // match" implementation would coincidentally produce the same answer as
  // "take the max," and the test could not distinguish the two. Here the
  // max (64) appears first and the last (11) is smaller, so only a genuine
  // max implementation passes.
  const text = '"Device Utilization %"=64\nsomething\n"Device Utilization %"=11\n';
  assert.equal(gpu.parseIoreg(text).utilization, 64);
});

test("parseIoreg reports unified-memory footprint when present", () => {
  const text = '"Alloc system memory"=4959191040,"Device Utilization %"=11,"In use system memory"=671350784';
  const g = gpu.parseIoreg(text);
  assert.equal(g.allocBytes, 4959191040);
  assert.equal(g.inUseBytes, 671350784);
});

test("parseIoreg returns nulls rather than throwing when ioreg gives nothing", () => {
  const g = gpu.parseIoreg("");
  assert.equal(g.utilization, null);
  assert.equal(g.allocBytes, null);
  assert.equal(gpu.parseIoreg(null).utilization, null);
});

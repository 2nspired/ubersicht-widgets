const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const COLLECT = path.join(__dirname, "..", "claude-usage.widget", "lib", "collect.js");

test("collect --mock prints a schema-conformant payload", () => {
  const out = execFileSync(process.execPath, [COLLECT, "--mock"], { encoding: "utf8" });
  const payload = JSON.parse(out);
  assert.ok(payload.generatedAt);
  assert.equal(payload.config.layout, "ticker");
  const claude = payload.providers.claude;
  assert.equal(claude.logs.status, "ok");
  assert.ok(claude.logs.today.costUsd > 0);
  assert.ok(Array.isArray(claude.logs.week.days) && claude.logs.week.days.length === 7);
  assert.ok(Array.isArray(claude.logs.models));
  assert.equal(claude.limits.status, "ok");
  const ids = claude.limits.buckets.map((b) => b.id);
  assert.deepEqual(ids, ["session", "week_all", "week_fable"]);
  for (const b of claude.limits.buckets) {
    assert.equal(typeof b.pctUsed, "number");
    assert.ok(b.resetsAt);
  }
});

test("collect --no-mock degrades gracefully (no layers yet)", () => {
  const out = execFileSync(process.execPath, [COLLECT, "--no-mock"], { encoding: "utf8" });
  const payload = JSON.parse(out);
  assert.ok(["ok","unavailable"].includes(payload.providers.claude.logs.status), "logs returns ok or unavailable");
  assert.equal(payload.providers.claude.limits.status, "error");
});

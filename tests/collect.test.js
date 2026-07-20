const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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

test("collect --no-mock with isolated env degrades both layers to unavailable", () => {
  // CLAUDE_USAGE_WIDGET_HOME redirects logs.js's log-file lookup to an empty
  // temp dir, so the logs layer degrades to "unavailable" for lack of any
  // log files. CLAUDE_USAGE_WIDGET_NO_KEYCHAIN is the matching seam for the
  // limits layer: it short-circuits collectLimits() before any Keychain or
  // network access, so this test never makes a live call to the Anthropic
  // usage endpoint and never touches the developer's real credentials,
  // regardless of what's in Keychain on the machine running the suite.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-collect-home-"));
  const out = execFileSync(process.execPath, [COLLECT, "--no-mock"], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_USAGE_WIDGET_HOME: tmp, CLAUDE_USAGE_WIDGET_NO_KEYCHAIN: "1" },
  });
  const payload = JSON.parse(out);
  assert.equal(payload.providers.claude.logs.status, "unavailable");
  assert.equal(payload.providers.claude.limits.status, "unavailable");
});

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

test("collect --no-mock degrades the logs layer gracefully when no log files exist", () => {
  // CLAUDE_USAGE_WIDGET_HOME only redirects logs.js's log-file lookup; it has
  // no effect on limits.js, which reads credentials from macOS Keychain
  // (readAccessToken() always uses the real os.homedir()) independent of
  // this override. So on a machine with valid Claude Code credentials, the
  // limits layer is expected to genuinely succeed here even though logs
  // degrades to "unavailable" for lack of any log files under the temp HOME.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-collect-home-"));
  const out = execFileSync(process.execPath, [COLLECT, "--no-mock"], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_USAGE_WIDGET_HOME: tmp },
  });
  const payload = JSON.parse(out);
  assert.equal(payload.providers.claude.logs.status, "unavailable");
  assert.ok(
    ["ok", "unavailable", "error"].includes(payload.providers.claude.limits.status),
    "limits layer must degrade instead of crashing collect.js"
  );
});

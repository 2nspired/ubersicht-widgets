// tests/dev-servers-collect.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const COLLECT = path.join(__dirname, "..", "dev-servers.widget", "lib", "collect.js");

// Four emit sites (mock, success, watchdog, main().catch) hand-construct
// { theme, themeError }; nothing previously asserted any of them actually
// did. Shared shape check so a dropped `theme: THEME.theme` at any site
// fails loudly instead of silently leaving the card unthemed.
function assertThemeShape(data) {
  assert.ok(data.theme && typeof data.theme === "object");
  const keys = Object.keys(data.theme);
  assert.equal(keys.length, 13, `expected 13 theme keys, got ${keys.length}`);
  for (const key of keys) {
    assert.equal(typeof data.theme[key], "string", `theme.${key} must be a string`);
  }
  assert.ok("themeError" in data, "payload is missing themeError");
}

test("collect --mock prints a valid payload with servers", () => {
  const out = execFileSync(process.execPath, [COLLECT, "--mock"], { encoding: "utf8" });
  const data = JSON.parse(out);
  assert.equal(data.status, "ok");
  assert.ok(Array.isArray(data.servers) && data.servers.length >= 3);
  assert.ok(data.config.show);
  const kinds = new Set(data.servers.map((s) => s.kind));
  assert.ok(kinds.has("process") && kinds.has("docker") && kinds.has("tunnel"));
  assertThemeShape(data);
});

test("collect live run exits 0 and prints one JSON document, ok or error", () => {
  const out = execFileSync(process.execPath, [COLLECT, "--no-mock"], {
    encoding: "utf8",
    timeout: 15000,
  });
  const data = JSON.parse(out);
  assert.ok(["ok", "error"].includes(data.status));
  assert.ok(Array.isArray(data.servers));
  assert.ok(data.config);
  assert.equal(typeof data.generatedAt, "string");
  for (const s of data.servers) {
    if (s.port != null) assert.ok(Number.isInteger(s.port));
    if (s.pid != null) assert.ok(Number.isInteger(s.pid));
  }
  assertThemeShape(data);
});

// tests/dev-servers-collect.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const COLLECT = path.join(__dirname, "..", "dev-servers.widget", "lib", "collect.js");

test("collect --mock prints a valid payload with servers", () => {
  const out = execFileSync(process.execPath, [COLLECT, "--mock"], { encoding: "utf8" });
  const data = JSON.parse(out);
  assert.equal(data.status, "ok");
  assert.ok(Array.isArray(data.servers) && data.servers.length >= 3);
  assert.ok(data.config.show);
  const kinds = new Set(data.servers.map((s) => s.kind));
  assert.ok(kinds.has("process") && kinds.has("docker") && kinds.has("tunnel"));
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
});

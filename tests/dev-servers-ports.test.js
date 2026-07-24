// tests/dev-servers-ports.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseLsof, dedupe, filterNoise } = require("../dev-servers.widget/lib/ports");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "lsof-listen.txt"), "utf8");

test("parseLsof extracts pid/command/port from -Fpcn output, incl. IPv6 and spaced names", () => {
  const rows = parseLsof(FIXTURE);
  assert.deepEqual(rows[0], { pid: 344, command: "node", port: 3000 });
  assert.ok(rows.some((r) => r.pid === 400 && r.command === "Google Chrome" && r.port === 9222));
  assert.ok(rows.some((r) => r.pid === 700 && r.port === 8080)); // [::1]:8080
  assert.ok(rows.some((r) => r.pid === 700 && r.port === 8081)); // localhost:8081
});

test("parseLsof skips garbage lines and port-less names", () => {
  assert.deepEqual(parseLsof("junk\np12\ncfoo\nn*:invalid\n"), []);
  assert.deepEqual(parseLsof(""), []);
});

test("dedupe collapses double-listings and multi-port pids to one row, lowest port first", () => {
  const rows = dedupe(parseLsof(FIXTURE));
  const node344 = rows.find((r) => r.pid === 344);
  assert.deepEqual(node344.ports, [3000]); // IPv4+IPv6 double-listing collapsed
  const node700 = rows.find((r) => r.pid === 700);
  assert.deepEqual(node700.ports, [8080, 8081]);
  assert.equal(node700.port, 8080);
});

test("filterNoise drops denylisted commands (case-insensitive prefix) and denylisted ports", () => {
  const rows = dedupe(parseLsof(FIXTURE));
  const kept = filterNoise(rows);
  assert.ok(!kept.some((r) => r.command === "Google Chrome"));
  assert.ok(!kept.some((r) => r.command === "ControlCe")); // its only port (7000) is denied too
  assert.ok(kept.some((r) => r.pid === 344));
  assert.ok(kept.some((r) => r.command === "postgres"));
});

test("filterNoise honors config ignoreProcesses and ignorePorts", () => {
  const rows = [
    { pid: 1, command: "node", port: 3000, ports: [3000] },
    { pid: 2, command: "mything", port: 4000, ports: [4000] },
    { pid: 3, command: "node", port: 5555, ports: [5555, 6666] },
  ];
  const kept = filterNoise(rows, { ignoreProcesses: ["MyThing"], ignorePorts: [5555] });
  assert.ok(!kept.some((r) => r.pid === 2));
  const partial = kept.find((r) => r.pid === 3);
  assert.deepEqual(partial.ports, [6666]); // denied port removed, row kept
  assert.equal(partial.port, 6666);
});

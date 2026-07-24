// tests/dev-servers-docker.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseDockerPs, mergeDocker } = require("../dev-servers.widget/lib/docker");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "docker-ps.jsonl"), "utf8");

test("parseDockerPs extracts name, image, published ports (deduped), compose project", () => {
  const cs = parseDockerPs(FIXTURE);
  assert.equal(cs.length, 3);
  assert.deepEqual(cs[0], {
    name: "acme-api-db-1",
    image: "postgres:16",
    ports: [5432], // IPv4+IPv6 publish lines dedupe to one port
    project: "acme-api",
  });
  assert.equal(cs[1].project, null);
  assert.deepEqual(cs[2].ports, []); // no published ports
});

test("parseDockerPs skips blank and malformed lines", () => {
  assert.deepEqual(parseDockerPs("\nnot json\n"), []);
  assert.deepEqual(parseDockerPs(""), []);
});

test("mergeDocker replaces docker proxy rows with container rows and drops portless containers", () => {
  const scanned = [
    { pid: 344, command: "node", port: 3000, ports: [3000] },
    { pid: 900, command: "com.docker.backend", port: 5432, ports: [5432] },
    { pid: 901, command: "com.docker.backend", port: 6379, ports: [6379] },
  ];
  const merged = mergeDocker(scanned, parseDockerPs(FIXTURE));
  assert.ok(merged.some((r) => r.pid === 344)); // untouched
  assert.ok(!merged.some((r) => r.command === "com.docker.backend"));
  const pg = merged.find((r) => r.kind === "docker" && r.port === 5432);
  assert.equal(pg.name, "acme-api-db-1");
  assert.equal(pg.project, "acme-api");
  assert.equal(pg.command, "postgres:16");
  assert.ok(!merged.some((r) => r.name === "worker-1")); // no published port
});

test("mergeDocker with no containers is a no-op that still strips docker daemon rows", () => {
  const scanned = [
    { pid: 344, command: "node", port: 3000, ports: [3000] },
    { pid: 900, command: "com.docker.backend", port: 60000, ports: [60000] },
  ];
  const merged = mergeDocker(scanned, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].pid, 344);
});

test("mergeDocker removes non-docker rows by port rule when all ports are published", () => {
  const scanned = [
    { pid: 344, command: "node", port: 3000, ports: [3000] },
    { pid: 902, command: "backend-helper", port: 5432, ports: [5432] },
  ];
  const merged = mergeDocker(scanned, parseDockerPs(FIXTURE));
  assert.ok(merged.some((r) => r.pid === 344)); // untouched
  assert.ok(!merged.some((r) => r.pid === 902)); // removed: not a docker daemon but all ports are published
});

test("mergeDocker uses container name as project fallback when compose label missing", () => {
  const scanned = [
    { pid: 344, command: "node", port: 3000, ports: [3000] },
  ];
  const merged = mergeDocker(scanned, parseDockerPs(FIXTURE));
  const redis = merged.find((r) => r.kind === "docker" && r.port === 6379);
  assert.equal(redis.name, "redis-solo");
  assert.equal(redis.project, "redis-solo");
});

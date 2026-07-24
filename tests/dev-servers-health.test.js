// tests/dev-servers-health.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const net = require("node:net");
const { probePort, probeAll } = require("../dev-servers.widget/lib/health");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("probePort reports 'up' for an HTTP server even on a 500 response", async () => {
  const srv = http.createServer((req, res) => { res.statusCode = 500; res.end(); });
  const port = await listen(srv);
  try {
    assert.equal(await probePort(port), "up");
  } finally {
    srv.close();
  }
});

test("probePort reports 'tcp' for a DB-designated port that accepts connections", async () => {
  const srv = net.createServer(() => {}); // accepts, says nothing
  const port = await listen(srv);
  try {
    assert.equal(await probePort(port, { dbPorts: new Set([port]) }), "tcp");
  } finally {
    srv.close();
  }
});

test("probePort reports 'tcp' for a non-HTTP listener (HTTP attempt times out)", async () => {
  const srv = net.createServer(() => {});
  const port = await listen(srv);
  try {
    assert.equal(await probePort(port, { timeoutMs: 150 }), "tcp");
  } finally {
    srv.close();
  }
});

test("probePort reports 'down' for a closed port", async () => {
  const srv = net.createServer();
  const port = await listen(srv);
  await new Promise((r) => srv.close(r)); // port now free
  assert.equal(await probePort(port, { timeoutMs: 150 }), "down");
});

test("probeAll probes in parallel and maps ports to verdicts", async () => {
  const a = http.createServer((req, res) => res.end("ok"));
  const pa = await listen(a);
  try {
    const m = await probeAll([pa]);
    assert.equal(m.get(pa), "up");
  } finally {
    a.close();
  }
});

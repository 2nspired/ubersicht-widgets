#!/usr/bin/env node
"use strict";
const net = require("net");
const http = require("http");

// Well-known non-HTTP service ports: skip the HTTP attempt, go straight to
// a TCP connect (mysql, postgres x2, redis, kafka, mongo, supabase-local pg).
const DB_PORTS = new Set([3306, 5432, 5433, 6379, 9092, 27017, 54322]);

function tcpCheck(port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

function httpCheck(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: timeoutMs }, (res) => {
      res.destroy(); // status line is all we need; never read the body
      resolve(true); // any HTTP response — even 4xx/5xx — means the server is up
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

async function probePort(port, { timeoutMs = 300, dbPorts = DB_PORTS } = {}) {
  if (dbPorts.has(port)) return (await tcpCheck(port, timeoutMs)) ? "tcp" : "down";
  if (await httpCheck(port, timeoutMs)) return "up";
  return (await tcpCheck(port, timeoutMs)) ? "tcp" : "down";
}

async function probeAll(ports, opts) {
  const verdicts = await Promise.all(ports.map((p) => probePort(p, opts)));
  return new Map(ports.map((p, i) => [p, verdicts[i]]));
}

module.exports = { probePort, probeAll, DB_PORTS };

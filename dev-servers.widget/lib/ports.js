#!/usr/bin/env node
"use strict";

// Processes that hold ports but are never dev servers. Matched
// case-insensitively as a prefix of lsof's command name (lsof truncates,
// e.g. "ControlCe" for Control Center).
const DENY_PROCESSES = [
  "rapportd", "sharingd", "controlce", "mdnsrespon", "airplay",
  "identitys", "assistantd", "cloudd", "bluetoothd", "remoted",
  "google", "chrome", "safari", "arc", "firefox", "brave", "spotify",
  "dropbox", "onedrive", "creative", "adobe", "logioption", "raycast",
  "uebersicht", "übersicht",
];

// Ports that are always system noise (AirPlay Receiver holds 5000/7000).
const DENY_PORTS = [5000, 7000];

// Parses `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` field output: p<pid>, c<command>,
// f<fd>, n<addr:port>. Field mode is used because the columnar output can't be
// split reliably when command names contain spaces.
function parseLsof(text) {
  const rows = [];
  let pid = null;
  let command = "?";
  for (const line of String(text).split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") {
      pid = Number(val);
      command = "?";
    } else if (tag === "c") {
      command = val;
    } else if (tag === "n" && Number.isInteger(pid)) {
      const port = Number((val.match(/:(\d+)$/) || [])[1]);
      if (Number.isInteger(port)) rows.push({ pid, command, port });
    }
  }
  return rows;
}

function dedupe(rows) {
  const byPid = new Map();
  for (const r of rows) {
    const cur = byPid.get(r.pid);
    if (!cur) {
      byPid.set(r.pid, { pid: r.pid, command: r.command, port: r.port, ports: [r.port] });
    } else if (!cur.ports.includes(r.port)) {
      cur.ports.push(r.port);
      cur.ports.sort((a, b) => a - b);
      cur.port = cur.ports[0];
    }
  }
  return [...byPid.values()];
}

function filterNoise(rows, config = {}) {
  const denyProc = DENY_PROCESSES.concat(
    (config.ignoreProcesses || []).map((s) => String(s).toLowerCase())
  );
  const denyPorts = new Set(DENY_PORTS.concat(config.ignorePorts || []));
  return rows
    .map((r) => {
      const ports = r.ports.filter((p) => !denyPorts.has(p));
      return { ...r, ports, port: ports[0] };
    })
    .filter(
      (r) =>
        r.ports.length > 0 &&
        !denyProc.some((d) => r.command.toLowerCase().startsWith(d))
    );
}

module.exports = { parseLsof, dedupe, filterNoise, DENY_PROCESSES, DENY_PORTS };

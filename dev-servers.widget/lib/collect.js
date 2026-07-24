#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const DEFAULTS = {
  position: { corner: "top-right" },
  refreshSeconds: 10,
  staleHours: 24,
  maxRows: 12,
  ignoreProcesses: [],
  ignorePorts: [],
  show: { uptime: true, health: true, cpu: true, mem: true, branch: true },
  mock: false,
};

function readConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8");
    const user = JSON.parse(raw);
    return { ...DEFAULTS, ...user, show: { ...DEFAULTS.show, ...(user.show || {}) } };
  } catch {
    return { ...DEFAULTS, show: { ...DEFAULTS.show } };
  }
}

// Read once at module level: main() and the error-emitting paths (watchdog,
// main().catch) all need it, and the watchdog fires outside main()'s scope.
const CONFIG = readConfig();

// Fixed argv only — observed process/container names are never passed as
// arguments; the only dynamic argv values are integer-validated PIDs.
// 2000ms default: main() runs two sequential Promise.all batches, so worst
// case is ~2x this value plus health probes (~300ms); must stay under the
// 5000ms watchdog below.
function run(cmd, args, timeoutMs = 2000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      // lsof exits non-zero in benign cases; whatever stdout produced is usable.
      resolve(String(stdout || ""));
    });
  });
}

async function main() {
  const config = CONFIG;
  const useMock = process.argv.includes("--no-mock")
    ? false
    : config.mock || process.argv.includes("--mock");

  if (useMock) {
    const mock = JSON.parse(fs.readFileSync(path.join(__dirname, "mock.json"), "utf8"));
    process.stdout.write(JSON.stringify({ ...mock, config }));
    return;
  }

  const { parseLsof, dedupe, filterNoise, applyConfigIgnores } = require("./ports");
  const { parseDockerPs, mergeDocker } = require("./docker");
  const enrich = require("./enrich");
  const { probeAll } = require("./health");

  const [lsofOut, dockerOut, allPs] = await Promise.all([
    run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]),
    run("docker", ["ps", "--format", "{{json .}}"]), // docker absent/stopped -> "" -> zero rows
    run("ps", ["-axo", "pid=,comm="]),
  ]);

  let rows = filterNoise(dedupe(parseLsof(lsofOut)), config).map((r) => ({
    kind: "process",
    ...r,
  }));
  rows = mergeDocker(rows, parseDockerPs(dockerOut));

  // Tunnels: reclassify port-scanned rows (ngrok holds its web-UI port),
  // append portless ones (stripe listen holds no local port).
  const byPid = new Map(rows.filter((r) => Number.isInteger(r.pid)).map((r) => [r.pid, r]));
  for (const t of enrich.parseTunnels(allPs)) {
    const existing = byPid.get(t.pid);
    if (existing) existing.kind = "tunnel";
    else rows.push({ ...t, port: null, ports: [] });
  }

  // Config ignores apply to the fully assembled row set (process + docker +
  // tunnel), not just the raw lsof scan — otherwise ignorePorts/ignoreProcesses
  // silently wouldn't affect docker/tunnel rows appended above.
  rows = applyConfigIgnores(rows, config);

  const pids = rows.map((r) => r.pid).filter((p) => Number.isInteger(p));
  const [psOut, cwdOut] = pids.length
    ? await Promise.all([
        run("ps", ["-o", "pid=,etime=,%cpu=,rss=", "-p", pids.join(",")]),
        run("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"]),
      ])
    : ["", ""];
  const stats = enrich.parsePs(psOut);
  const cwds = enrich.parseCwds(cwdOut);

  const ports = [...new Set(rows.map((r) => r.port).filter((p) => Number.isInteger(p)))];
  const health = config.show.health ? await probeAll(ports) : new Map();

  const staleSecs = config.staleHours * 3600;
  const servers = rows.map((r) => {
    const stat = stats.get(r.pid) || {};
    const cwd = Number.isInteger(r.pid) ? cwds.get(r.pid) : null;
    const root = cwd ? enrich.findProjectRoot(cwd) : null;
    return {
      kind: r.kind,
      pid: Number.isInteger(r.pid) ? r.pid : null,
      port: Number.isInteger(r.port) ? r.port : null,
      ports: r.ports || [],
      command: r.command,
      name: r.name || null,
      project: r.project || (root ? path.basename(root) : null),
      branch: config.show.branch && root ? enrich.readBranch(root) : null,
      ageSeconds: stat.ageSeconds ?? null,
      age: enrich.formatAge(stat.ageSeconds ?? null),
      stale: stat.ageSeconds != null && stat.ageSeconds > staleSecs,
      cpu: stat.cpu ?? null,
      memMb: stat.memMb ?? null,
      health: Number.isInteger(r.port) ? health.get(r.port) || "unknown" : "unknown",
    };
  });

  servers.sort(
    (a, b) =>
      String(a.project || a.command).localeCompare(String(b.project || b.command)) ||
      (a.port || 0) - (b.port || 0)
  );

  process.stdout.write(
    JSON.stringify({ generatedAt: new Date().toISOString(), status: "ok", config, servers })
  );
}

// Watchdog: a hung docker/lsof must not pile up collectors across refreshes.
const watchdog = setTimeout(() => {
  const json = JSON.stringify({
    generatedAt: new Date().toISOString(),
    status: "error",
    message: "collector timed out",
    config: CONFIG,
    servers: [],
  });
  process.stdout.write(json, () => process.exit(0));
}, 5000);

main()
  .then(() => clearTimeout(watchdog))
  .catch((err) => {
    clearTimeout(watchdog);
    process.stdout.write(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        status: "error",
        message: String((err && err.message) || err),
        config: CONFIG,
        servers: [],
      })
    );
    process.exitCode = 0; // never crash the widget
  });

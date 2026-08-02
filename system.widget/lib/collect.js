#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execFileSync } = require("child_process");

const cpuLib = require("./cpu");
const memLib = require("./memory");
const gpuLib = require("./gpu");
const hist = require("./history");
const { findProjectRoot, parseCwds } = require("./project");
const { resolveTheme } = require("./theme");

const DEFAULTS = {
  theme: null,
  layout: "ghost",
  position: { corner: "top-right" },
  refreshSeconds: 3,
  historyMinutes: 5,
  topN: 3,
  gpuThreshold: 10,
  spike: { percent: 70, seconds: 15 },
  show: { gpu: true, memory: true, history: true, spike: true },
  scale: 1.5,
  mock: false,
};

function readConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8");
    const user = JSON.parse(raw);
    return {
      ...DEFAULTS, ...user,
      show: { ...DEFAULTS.show, ...(user.show || {}) },
      spike: { ...DEFAULTS.spike, ...(user.spike || {}) },
    };
  } catch {
    return { ...DEFAULTS, show: { ...DEFAULTS.show }, spike: { ...DEFAULTS.spike } };
  }
}

// Module level so the watchdog and main().catch — which run outside main()'s
// scope — can still emit a themed payload.
const CONFIG = readConfig();
const THEME = resolveTheme({ widgetDir: __dirname, config: CONFIG });

const CACHE = process.env.UBERSICHT_SYSTEM_WIDGET_CACHE ||
  path.join(os.homedir(), ".cache", "ubersicht-system-widget", "history.json");

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    return { sample: null, at: null, history: [] };
  }
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(data));
  } catch {
    // A read-only cache must degrade to "no history", never crash the widget.
  }
}

function run(cmd, args, timeoutMs = 2000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(String(stdout || ""));
    });
  });
}

function sysctl(key) {
  try {
    return execFileSync("sysctl", ["-n", key], { encoding: "utf8", timeout: 1000 }).trim();
  } catch {
    return "";
  }
}

function emit(extra) {
  const base = {
    generatedAt: new Date().toISOString(),
    config: CONFIG,
    theme: THEME.theme,
    themeError: THEME.themeError,
  };
  process.stdout.write(JSON.stringify(Object.assign(base, extra)));
}

async function main() {
  const useMock = process.argv.includes("--no-mock")
    ? false
    : CONFIG.mock || process.argv.includes("--mock");

  if (useMock) {
    const mock = JSON.parse(fs.readFileSync(path.join(__dirname, "mock.json"), "utf8"));
    emit(Object.assign({ status: "ok", cpuEstimated: false }, mock));
    return;
  }

  const nowMs = Date.now();
  const cache = readCache();
  const cores = parseInt(sysctl("hw.logicalcpu"), 10) || 1;

  const [psOut, ioregOut, vmOut] = await Promise.all([
    run("ps", ["-axo", "pid=,time=,rss=,comm="]),
    CONFIG.show.gpu ? run("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]) : Promise.resolve(""),
    run("vm_stat", []),
  ]);

  const samples = cpuLib.parsePsSample(psOut);
  const elapsed = cache.at ? (nowMs - cache.at) / 1000 : 0;
  const discontinuous = hist.isDiscontinuity(cache.at, nowMs);

  let percents;
  let cpuEstimated = false;
  if (!discontinuous && cache.sample) {
    const prev = new Map(cache.sample.map((e) => [e[0], { cpuSeconds: e[1], comm: e[2] }]));
    percents = cpuLib.computeDeltas(prev, samples, elapsed);
  } else {
    // First run (or post-sleep): no delta is possible. Fall back to ps's
    // decaying average for this one cycle rather than showing blanks.
    percents = new Map();
    const fallback = await run("ps", ["-axo", "pid=,pcpu="]);
    for (const line of fallback.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+([\d.]+)/);
      if (m) percents.set(parseInt(m[1], 10), parseFloat(m[2]));
    }
    cpuEstimated = true;
  }

  // Resolve projects for dev processes only, and only for the shortlist —
  // one lsof call on a handful of pids, the same approach dev-servers uses.
  const devPids = [...samples.entries()]
    .filter(([, s]) => cpuLib.classify(s.comm).kind === "dev")
    .map(([pid]) => pid);
  const projectByPid = new Map();
  if (devPids.length) {
    const cwdOut = await run("lsof", ["-a", "-p", devPids.join(","), "-d", "cwd", "-Fpn"]);
    for (const [pid, cwd] of parseCwds(cwdOut)) {
      const root = findProjectRoot(cwd);
      if (root) projectByPid.set(pid, path.basename(root));
    }
  }

  const groups = cpuLib.groupProcesses(samples, percents, projectByPid);
  // The widget must not rank itself: on an idle machine its own ~3% would
  // otherwise take the top slot. dev-servers filters Übersicht the same way.
  const selfLabels = new Set(["node", "Übersicht", "Uebersicht"]);
  const visible = groups.filter((g) => !(g.kind !== "dev" && selfLabels.has(g.label)));

  const totalPercent = [...percents.values()].reduce((a, b) => a + b, 0);
  const headline = Math.max(0, Math.min(100, Math.round(totalPercent / cores)));

  const vmStat = memLib.parseVmStat(vmOut);
  const memory = memLib.buildMemory({
    vmStat,
    totalBytes: parseInt(sysctl("hw.memsize"), 10) || 0,
    pressureLevel: parseInt(sysctl("kern.memorystatus_vm_pressure_level"), 10),
    swapUsedBytes: memLib.parseSwapUsed(sysctl("vm.swapusage")),
  });

  const gpu = gpuLib.parseIoreg(ioregOut);
  gpu.visible = CONFIG.show.gpu && typeof gpu.utilization === "number" &&
    gpu.utilization >= CONFIG.gpuThreshold;

  let history = [];
  let spike = null;
  if (CONFIG.show.history) {
    const windowMs = CONFIG.historyMinutes * 60 * 1000;
    const sample = { t: nowMs, cpu: headline, mem: memory.usedPercent, gpu: gpu.utilization };
    history = discontinuous
      ? [sample]
      : hist.appendSample(cache.history, sample, windowMs);
    if (CONFIG.show.spike) spike = hist.detectSpike(history, CONFIG.spike, nowMs);
  }

  // The previous ps sample is cached even when show.history is false: accurate
  // CPU percentages are computed by diffing against it, so dropping it would
  // permanently degrade the widget to ps's decaying average. Only the ring is
  // suppressed in that mode.
  writeCache({
    at: nowMs,
    sample: [...samples.entries()].map(([pid, s]) => [pid, s.cpuSeconds, s.comm]),
    history,
  });

  emit({
    status: "ok",
    cpuEstimated,
    cpu: { percent: headline, cores, top: cpuLib.topBy(visible, "percent", CONFIG.topN) },
    memory: Object.assign(memory, { top: cpuLib.topBy(visible, "rssKb", CONFIG.topN) }),
    gpu,
    history,
    spike,
  });
}

// A hung ps/ioreg must not pile up collectors across refreshes.
const watchdog = setTimeout(() => {
  emit({ status: "error", message: "collector timed out", cpu: null, history: [] });
  process.exit(0);
}, 4000);

main()
  .then(() => clearTimeout(watchdog))
  .catch((err) => {
    clearTimeout(watchdog);
    emit({
      status: "error",
      message: String((err && err.message) || err),
      cpu: null,
      history: [],
    });
    process.exitCode = 0; // never crash the widget
  });

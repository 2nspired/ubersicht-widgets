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
  position: { corner: "top-right", offset: 0 },
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
      position: { ...DEFAULTS.position, ...(user.position || {}) },
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
  // Plain writeFileSync(CACHE, ...) truncates-then-writes CACHE in place.
  // Übersicht runs this collector every 3s, so one run's write can overlap
  // another run's read of the same path; a reader can then see a torn file
  // (e.g. a shorter payload's bytes followed by the previous, longer write's
  // leftover tail — the "Extra data" JSON parse error observed live).
  // Writing to a per-process temp file and rename(2)-ing it into place
  // avoids this: rename is atomic on POSIX within a filesystem, so a
  // concurrent reader always sees either the old complete file or the new
  // complete file, never a mixture. `process.pid` in the temp name keeps
  // concurrent collectors from colliding with each other's temp file.
  const tmp = `${CACHE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, CACHE);
  } catch {
    // A read-only cache (or a failed rename) must degrade to "no history",
    // never crash the widget. Best-effort cleanup so repeated failures don't
    // litter the cache directory with abandoned temp files.
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Nothing more to do if even cleanup fails.
    }
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

  // Exclude the collector's own process by PID before it can reach grouping.
  // See cpu.excludeSelf: doing it here also means the cached sample never
  // carries this run's own (always-fresh) PID forward.
  const samples = cpuLib.excludeSelf(cpuLib.parsePsSample(psOut), process.pid);
  const elapsed = cache.at ? (nowMs - cache.at) / 1000 : 0;
  const discontinuous = hist.isDiscontinuity(cache.at, nowMs);

  // A cache file can be valid JSON with an invalid shape (hand-edited, from a
  // future/older format, etc.) — `sample` might not be an array at all. Treat
  // that the same as "no cached sample": fall through to the first-run path
  // rather than letting `.map` throw and brick the widget on a bad cache that
  // is never overwritten because the throw happens before writeCache below.
  const prevList = Array.isArray(cache.sample) ? cache.sample : null;

  let percents;
  let cpuEstimated = false;
  if (!discontinuous && prevList) {
    const prev = new Map(prevList.map((e) => [e[0], { cpuSeconds: e[1], comm: e[2] }]));
    percents = cpuLib.computeDeltas(prev, samples, elapsed);
  } else {
    // First run (or post-sleep): no delta is possible. Fall back to ps's
    // decaying average for this one cycle rather than showing blanks.
    //
    // Note: this fallback `ps` call covers every process on the machine,
    // including the collector's own transient node process — unlike the
    // delta path above, whose `samples` map has already had this process's
    // pid removed by excludeSelf. The two paths therefore sum slightly
    // different populations for one cycle. This is intentionally left as-is:
    // it lasts exactly one 3-second refresh (cpuEstimated is true only here),
    // and the headline's Math.max(0, Math.min(100, ...)) clamp absorbs the
    // negligible skew from a single always-cheap collector process.
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
  // Two distinct exclusions, for two distinct reasons:
  //  - This collector's own process is already gone by PID (above), before
  //    grouping. It couldn't have accrued a delta anyway: Übersicht spawns a
  //    fresh node process every refresh, so its PID is never present in the
  //    previous cached sample and computeDeltas skips it.
  //  - Übersicht's long-lived app process (/Applications/Übersicht.app/...)
  //    is a real, continuously-running process with real CPU cost, so it is
  //    filtered by (NFC-normalized) label instead — see cpu.isSelfGroup for
  //    why raw comparison silently fails here. dev-servers filters it the
  //    same way.
  const selfLabels = new Set(["Übersicht", "Uebersicht"].map((s) => s.normalize("NFC")));
  const visible = groups.filter((g) => !cpuLib.isSelfGroup(g, selfLabels));

  const totalPercent = [...percents.values()].reduce((a, b) => a + b, 0);
  const headline = cpuLib.normalizeHeadline(totalPercent, cores);

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

// Only auto-run when executed directly (`node collect.js`), exactly as
// before. Guarding this behind require.main lets tests `require()` this
// module to exercise writeCache/readCache directly (e.g. for the cache
// atomicity tests) without spawning a collector process and without ever
// changing what the CLI itself prints.
if (require.main === module) {
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
}

module.exports = { writeCache, readCache, CACHE };

"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const cpu = require("../system.widget/lib/cpu.js");

test("parseCpuTime handles macOS unbounded-minutes format", () => {
  // macOS ps emits MINUTES:SECONDS.HUNDREDTHS with minutes unbounded —
  // WindowServer really does read 896:38.07, not 14:56:38.
  assert.equal(cpu.parseCpuTime("896:38.07"), 896 * 60 + 38.07);
  assert.equal(cpu.parseCpuTime("0:00.50"), 0.5);
  assert.equal(cpu.parseCpuTime("2:06.04"), 126.04);
});

test("parseCpuTime defensively accepts a three-field form", () => {
  assert.equal(cpu.parseCpuTime("1:02:03"), 3723);
});

test("parseCpuTime returns null on garbage", () => {
  assert.equal(cpu.parseCpuTime("nonsense"), null);
  assert.equal(cpu.parseCpuTime(""), null);
  assert.equal(cpu.parseCpuTime(null), null);
});

test("parsePsSample reads pid, cpu time, rss and full command path", () => {
  const text = fs.readFileSync(
    path.join(__dirname, "fixtures", "ps-sample.txt"), "utf8");
  const map = cpu.parsePsSample(text);
  assert.ok(map.size > 5);
  const obsidian = map.get(357);
  assert.equal(obsidian.cpuSeconds, 126.04);
  assert.equal(obsidian.rssKb, 83440);
  assert.ok(obsidian.comm.endsWith("Obsidian Helper (GPU)"));
});

test("parsePsSample keeps spaces in command paths", () => {
  const map = cpu.parsePsSample("  357   2:06.04  83440 /App/Some App.app/Contents/MacOS/Some App\n");
  assert.equal(map.get(357).comm, "/App/Some App.app/Contents/MacOS/Some App");
});

test("computeDeltas converts cpu-second growth into per-core percent", () => {
  const prev = new Map([[1, { cpuSeconds: 100, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 103, comm: "/bin/a" }]]);
  // 3 cpu-seconds over 3 wall-seconds = one core fully busy = 100%
  assert.equal(cpu.computeDeltas(prev, curr, 3).get(1), 100);
});

test("computeDeltas reports above 100% for multi-threaded processes", () => {
  const prev = new Map([[1, { cpuSeconds: 0, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 6, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).get(1), 200);
});

test("computeDeltas drops negative deltas from recycled pids", () => {
  const prev = new Map([[1, { cpuSeconds: 500, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 2, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).has(1), false);
});

test("computeDeltas drops a pid whose comm changed — pid reuse", () => {
  const prev = new Map([[1, { cpuSeconds: 10, comm: "/bin/old" }]]);
  const curr = new Map([[1, { cpuSeconds: 12, comm: "/bin/new" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).has(1), false);
});

test("computeDeltas omits pids absent from the previous sample", () => {
  const prev = new Map();
  const curr = new Map([[1, { cpuSeconds: 5, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).size, 0);
});

test("computeDeltas returns empty for a non-positive window", () => {
  const prev = new Map([[1, { cpuSeconds: 1, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 2, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 0).size, 0);
  assert.equal(cpu.computeDeltas(prev, curr, -5).size, 0);
});

test("bundleName takes the FIRST .app in a nested path", () => {
  // Helper processes live in nested bundles. Taking the last would yield
  // "Obsidian Helper (GPU)" and defeat the entire point of grouping.
  assert.equal(
    cpu.bundleName("/Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (GPU).app/Contents/MacOS/Obsidian Helper (GPU)"),
    "Obsidian");
  // Docker nests three deep.
  assert.equal(
    cpu.bundleName("/Applications/Docker.app/Contents/MacOS/Docker Desktop.app/Contents/Frameworks/Docker Desktop Helper (GPU).app/Contents/MacOS/Docker Desktop Helper (GPU)"),
    "Docker");
  assert.equal(cpu.bundleName("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "Google Chrome");
});

test("bundleName returns null for non-bundle executables", () => {
  assert.equal(cpu.bundleName("/usr/bin/ssh"), null);
  assert.equal(cpu.bundleName("/Users/me/.local/share/fnm/node-versions/v22/installation/bin/node"), null);
  assert.equal(cpu.bundleName(""), null);
});

test("classify identifies app bundles, dev binaries and plain executables", () => {
  assert.deepEqual(
    cpu.classify("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    { kind: "app", label: "Google Chrome" });
  assert.deepEqual(
    cpu.classify("/Users/me/.local/share/fnm/node-versions/v22/installation/bin/node"),
    { kind: "dev", label: "node" });
  assert.deepEqual(
    cpu.classify("/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer"),
    { kind: "exe", label: "WindowServer" });
  assert.deepEqual(cpu.classify("/usr/bin/python3.12"), { kind: "dev", label: "python3.12" });
});

test("groupProcesses collapses an app family into one row", () => {
  const samples = new Map([
    [1, { comm: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", rssKb: 100, cpuSeconds: 0 }],
    [2, { comm: "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper", rssKb: 200, cpuSeconds: 0 }],
    [3, { comm: "/System/Library/X/WindowServer", rssKb: 50, cpuSeconds: 0 }],
  ]);
  const percents = new Map([[1, 78], [2, 83], [3, 29]]);
  const groups = cpu.groupProcesses(samples, percents, new Map());

  const chrome = groups.find((g) => g.label === "Google Chrome");
  assert.equal(chrome.percent, 161);
  assert.equal(chrome.rssKb, 300);
  assert.equal(chrome.count, 2);
  assert.equal(groups[0].label, "Google Chrome", "sorted by percent desc");
});

test("groupProcesses labels dev processes by project, keeping them separate", () => {
  const samples = new Map([
    [10, { comm: "/usr/local/bin/node", rssKb: 100, cpuSeconds: 0 }],
    [11, { comm: "/usr/local/bin/node", rssKb: 200, cpuSeconds: 0 }],
  ]);
  const percents = new Map([[10, 38], [11, 12]]);
  const projects = new Map([[10, "abra-abr"], [11, "project-tracker"]]);
  const groups = cpu.groupProcesses(samples, percents, projects);

  assert.equal(groups.length, 2, "different projects must not merge");
  assert.equal(groups[0].label, "node · abra-abr");
  assert.equal(groups[0].percent, 38);
});

test("groupProcesses merges dev processes sharing one project", () => {
  const samples = new Map([
    [10, { comm: "/usr/local/bin/node", rssKb: 100, cpuSeconds: 0 }],
    [11, { comm: "/usr/local/bin/node", rssKb: 200, cpuSeconds: 0 }],
  ]);
  const percents = new Map([[10, 10], [11, 20]]);
  const projects = new Map([[10, "acme"], [11, "acme"]]);
  const groups = cpu.groupProcesses(samples, percents, projects);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].percent, 30);
  assert.equal(groups[0].count, 2);
});

test("groupProcesses falls back to the bare binary when no project resolves", () => {
  const samples = new Map([[10, { comm: "/usr/local/bin/node", rssKb: 100, cpuSeconds: 0 }]]);
  const groups = cpu.groupProcesses(samples, new Map([[10, 5]]), new Map());
  assert.equal(groups[0].label, "node");
});

test("groupProcesses treats a missing percentage as zero, keeping rss usable", () => {
  const samples = new Map([[10, { comm: "/usr/bin/foo", rssKb: 400, cpuSeconds: 0 }]]);
  const groups = cpu.groupProcesses(samples, new Map(), new Map());
  assert.equal(groups[0].percent, 0);
  assert.equal(groups[0].rssKb, 400);
});

test("topBy returns the n largest by the requested field", () => {
  const groups = [
    { label: "a", percent: 5, rssKb: 900 },
    { label: "b", percent: 80, rssKb: 100 },
    { label: "c", percent: 40, rssKb: 500 },
  ];
  assert.deepEqual(cpu.topBy(groups, "percent", 2).map((g) => g.label), ["b", "c"]);
  assert.deepEqual(cpu.topBy(groups, "rssKb", 2).map((g) => g.label), ["a", "c"]);
});

test("excludeSelf removes exactly the given pid", () => {
  const samples = new Map([
    [1, { comm: "/bin/a", rssKb: 10, cpuSeconds: 0 }],
    [2, { comm: "/usr/local/bin/node", rssKb: 20, cpuSeconds: 3 }],
  ]);
  const out = cpu.excludeSelf(samples, 1);
  assert.equal(out.has(1), false);
  assert.equal(out.size, 1);
});

test("excludeSelf leaves every other entry untouched, including other bare-node processes", () => {
  // The collector's own pid must be the ONLY thing removed. A machine can
  // legitimately run several unrelated bare "node" processes (same comm as
  // the collector itself); none of them may be affected by pid-based removal.
  const samples = new Map([
    [10, { comm: "/usr/local/bin/node", rssKb: 100, cpuSeconds: 5 }],
    [11, { comm: "/usr/local/bin/node", rssKb: 200, cpuSeconds: 8 }],
    [12, { comm: "/usr/local/bin/node", rssKb: 300, cpuSeconds: 12 }],
  ]);
  const out = cpu.excludeSelf(samples, 10);
  assert.equal(out.size, 2);
  assert.deepEqual(out.get(11), { comm: "/usr/local/bin/node", rssKb: 200, cpuSeconds: 8 });
  assert.deepEqual(out.get(12), { comm: "/usr/local/bin/node", rssKb: 300, cpuSeconds: 12 });
});

test("excludeSelf is a no-op, not an error, when the pid is absent", () => {
  const samples = new Map([[1, { comm: "/bin/a", rssKb: 10, cpuSeconds: 0 }]]);
  const out = cpu.excludeSelf(samples, 999999);
  assert.equal(out.size, 1);
  assert.deepEqual(out.get(1), { comm: "/bin/a", rssKb: 10, cpuSeconds: 0 });
});

test("excludeSelf does not mutate the input map", () => {
  const samples = new Map([[1, { comm: "/bin/a", rssKb: 10, cpuSeconds: 0 }]]);
  cpu.excludeSelf(samples, 1);
  assert.equal(samples.has(1), true, "the caller's original map must be untouched");
});

test("isSelfGroup excludes an NFD-encoded label via NFC normalization", () => {
  // macOS `ps` emits the app's bundle name in NFD: "U" (U+0055) followed by
  // a separate U+0308 COMBINING DIAERESIS codepoint, not the precomposed
  // U+00DC a typed source literal normally contains. Both strings below are
  // built from explicit \uXXXX escapes rather than typed accented
  // characters, so this test cannot silently be "fixed" into a vacuous
  // NFC-vs-NFC comparison by an editor or formatting tool.
  const nfdLabel = "U\u0308bersicht"; // U+0055, U+0308, b,e,r,s,i,c,h,t (decomposed)
  const nfcLabel = "\u00DCbersicht"; // U+00DC, b,e,r,s,i,c,h,t (precomposed)
  assert.notEqual(
    nfdLabel, nfcLabel,
    "sanity check: NFD and NFC encodings of the same word are different JS strings"
  );
  assert.equal(nfdLabel.normalize("NFC"), nfcLabel, "sanity check: both normalize to the same NFC string");
  const selfLabels = new Set([nfcLabel, "Uebersicht"]);
  assert.equal(cpu.isSelfGroup({ kind: "app", label: nfdLabel }, selfLabels), true);
});

test("isSelfGroup never hides a dev-kind group, even one sharing a self label", () => {
  // A project-less "node" process is exactly what the widget exists to
  // surface, so dev-kind groups must never be filtered by label.
  const selfLabels = new Set(["node"]);
  assert.equal(cpu.isSelfGroup({ kind: "dev", label: "node" }, selfLabels), false);
});

test("isSelfGroup does not exclude unrelated app labels", () => {
  const selfLabels = new Set(["Übersicht", "Uebersicht"]);
  assert.equal(cpu.isSelfGroup({ kind: "app", label: "Google Chrome" }, selfLabels), false);
});

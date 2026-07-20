// claude-usage.widget/lib/logs.js
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const PRICING = require("./pricing.json");

function parseLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  const u = obj && obj.message && obj.message.usage;
  if (!u || !obj.timestamp) return null;
  const split = u.cache_creation || null;
  return {
    ts: new Date(obj.timestamp),
    model: obj.message.model || "unknown",
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite5m: split ? split.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0,
    cacheWrite1h: split ? split.ephemeral_1h_input_tokens || 0 : 0,
  };
}

function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ZERO = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

const MODEL_ALIASES = {
  fable: "claude-fable-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
  opus: "claude-opus-4-8",
};

function resolvePricingKey(model, pricing) {
  if (pricing[model]) return model;
  const undated = model.replace(/-\d{8}$/, "");
  if (pricing[undated]) return undated;
  if (MODEL_ALIASES[model] && pricing[MODEL_ALIASES[model]]) return MODEL_ALIASES[model];
  return null;
}

function summarizeFile(filePath) {
  const days = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const e = parseLine(line);
    if (!e || isNaN(e.ts)) continue;
    const key = localDayKey(e.ts);
    const day = (days[key] = days[key] || { models: {} });
    const m = (day.models[e.model] = day.models[e.model] || ZERO());
    m.input += e.input;
    m.output += e.output;
    m.cacheRead += e.cacheRead;
    m.cacheWrite5m += e.cacheWrite5m;
    m.cacheWrite1h += e.cacheWrite1h;
  }
  return { days };
}

function findProjectDirs(home = os.homedir()) {
  let entries;
  try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => d.isDirectory() && d.name.startsWith(".claude"))
    .map((d) => path.join(home, d.name, "projects"))
    .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

function listJsonlFiles(projectsDir) {
  const out = [];
  let projects;
  try { projects = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch { return out; }
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const dir = path.join(projectsDir, proj.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) if (f.endsWith(".jsonl")) out.push(path.join(dir, f));
  }
  return out;
}

function costUsd(model, sums, pricing) {
  const key = resolvePricingKey(model, pricing);
  if (!key) return null;
  const r = pricing[key];
  return (
    (sums.input * r.input +
      sums.output * r.output +
      sums.cacheRead * r.cacheRead +
      sums.cacheWrite5m * r.cacheWrite5m +
      sums.cacheWrite1h * r.cacheWrite1h) / 1e6
  );
}

const totalTokens = (s) => s.input + s.output + s.cacheRead + s.cacheWrite5m + s.cacheWrite1h;

function buildLogsSection(fileSummaries, now, pricing) {
  const dayKeys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dayKeys.push(localDayKey(d));
  }
  const todayKey = dayKeys[6];

  const perDay = {}; // key -> {tokens, costUsd}
  const todayModels = {}; // model -> {tokens, costUsd}
  let sessions = 0;

  for (const file of fileSummaries) {
    if (file.days[todayKey]) sessions++;
    for (const [dayKey, day] of Object.entries(file.days)) {
      if (!dayKeys.includes(dayKey)) continue;
      const slot = (perDay[dayKey] = perDay[dayKey] || { tokens: 0, costUsd: 0 });
      for (const [model, sums] of Object.entries(day.models)) {
        slot.tokens += totalTokens(sums);
        slot.costUsd += costUsd(model, sums, pricing) || 0;
        if (dayKey === todayKey) {
          const tm = (todayModels[model] = todayModels[model] || { tokens: 0, costUsd: 0 });
          tm.tokens += totalTokens(sums);
          tm.costUsd += costUsd(model, sums, pricing) || 0;
        }
      }
    }
  }

  const days = dayKeys.map((date) => ({
    date,
    costUsd: round2((perDay[date] || {}).costUsd || 0),
    tokens: (perDay[date] || {}).tokens || 0,
  }));
  const today = days[6];

  return {
    status: "ok",
    today: { costUsd: today.costUsd, tokens: today.tokens, sessions },
    week: { costUsd: round2(days.reduce((a, d) => a + d.costUsd, 0)), days },
    models: Object.entries(todayModels)
      .map(([model, v]) => ({ model, tokens: v.tokens, costUsd: round2(v.costUsd) }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

function startOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function summarizeFileCached(filePath, cache, now = new Date()) {
  const mtimeMs = fs.statSync(filePath).mtimeMs;
  const cached = cache[filePath];
  if (cached && cached.mtimeMs === mtimeMs) return cached.summary;
  const summary = summarizeFile(filePath);
  if (mtimeMs < startOfToday(now)) cache[filePath] = { mtimeMs, summary };
  return summary;
}

async function collectLogs(opts = {}) {
  const home = opts.home || os.homedir();
  const now = opts.now || new Date();
  const cachePath =
    opts.cachePath || path.join(home, ".cache", "claude-usage-widget", "daily.json");

  const dirs = findProjectDirs(home);
  const files = dirs.flatMap(listJsonlFiles);
  if (files.length === 0) return { status: "unavailable", message: "no claude logs found" };

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch {}

  const summaries = [];
  for (const f of files) {
    try { summaries.push(summarizeFileCached(f, cache, now)); } catch {}
  }

  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache));
  } catch {}

  return buildLogsSection(summaries, now, PRICING);
}

module.exports = { parseLine, summarizeFile, findProjectDirs, listJsonlFiles, localDayKey, ZERO, costUsd, buildLogsSection, totalTokens, resolvePricingKey, summarizeFileCached, collectLogs };

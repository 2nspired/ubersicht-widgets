// claude-usage.widget/lib/logs.js
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

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

module.exports = { parseLine, summarizeFile, findProjectDirs, listJsonlFiles, localDayKey, ZERO };

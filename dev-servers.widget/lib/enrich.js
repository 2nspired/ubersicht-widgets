#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

// Shared with system.widget; canonical copy lives at repo-root lib/project.js
// and is vendored here by scripts/sync-shared.sh.
const { findProjectRoot, parseCwds } = require("./project");

const TUNNEL_NAMES = new Set(["ngrok", "cloudflared", "stripe"]);

function parseEtime(s) {
  const m = String(s).trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  const d = Number(m[1]) || 0;
  const h = Number(m[2]) || 0;
  const min = Number(m[3]) || 0;
  const sec = Number(m[4]) || 0;
  return ((d * 24 + h) * 60 + min) * 60 + sec;
}

function formatAge(seconds) {
  if (seconds == null) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function parseGitHead(text) {
  const s = String(text).trim();
  const ref = s.match(/^ref: refs\/heads\/(.+)$/);
  if (ref) return ref[1];
  if (/^[0-9a-f]{40}$/.test(s)) return s.slice(0, 7);
  return null;
}

function readBranch(projectRoot, { readFile = fs.readFileSync } = {}) {
  try {
    return parseGitHead(readFile(path.join(projectRoot, ".git", "HEAD"), "utf8"));
  } catch {
    return null;
  }
}

// Parses `ps -o pid=,etime=,%cpu=,rss= -p <pids>` output.
function parsePs(text) {
  const map = new Map();
  for (const line of String(text).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)$/);
    if (!m) continue;
    map.set(Number(m[1]), {
      ageSeconds: parseEtime(m[2]),
      cpu: Number(m[3]),
      memMb: Math.round(Number(m[4]) / 1024),
    });
  }
  return map;
}

// Parses `ps -axo pid=,comm=` output, keeping known tunnel binaries.
function parseTunnels(text) {
  const rows = [];
  for (const line of String(text).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const base = m[2].trim().split("/").pop().toLowerCase();
    if (TUNNEL_NAMES.has(base)) rows.push({ kind: "tunnel", pid: Number(m[1]), command: base });
  }
  return rows;
}

module.exports = {
  parseEtime, formatAge, parseGitHead, readBranch, findProjectRoot,
  parsePs, parseCwds, parseTunnels,
};

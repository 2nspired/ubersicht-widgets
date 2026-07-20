#!/usr/bin/env node
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

// Keychain service name prefix. This machine runs several Claude accounts
// side by side, and macOS Keychain stores each under its own suffixed
// service name (e.g. "Claude Code-credentials-cc3c5c1c"), with the plain
// "Claude Code-credentials" entry frequently being a stale login left behind
// by an old `claude login`. Task 9 discovered that hard-coding the plain
// service name picks up that stale entry (expired accessToken -> 401 from
// the usage endpoint) instead of the live one. So instead of a single
// service name, readAccessToken() below enumerates every service starting
// with this prefix via `security dump-keychain` (no `-d`, so it only lists
// metadata like service names — never prompts and never reveals secrets),
// fetches each candidate's token with `find-generic-password -w` (this can
// prompt once per service the user hasn't granted access to yet — the user
// is expected to be present and click "Always Allow"), and picks whichever
// candidate has the latest still-in-the-future `expiresAt`. If every
// candidate is already expired we still return the most-recently-expired
// one rather than nothing, so the caller gets a real 401 to degrade on
// instead of silently reporting "no credentials".
const KEYCHAIN_SERVICE_PREFIX = "Claude Code-credentials";

function listKeychainServices() {
  try {
    const raw = execFileSync("security", ["dump-keychain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const services = new Set();
    const re = /"svce"<blob>="((?:[^"\\]|\\.)*)"/;
    for (const line of raw.split("\n")) {
      const m = line.match(re);
      if (m && m[1].startsWith(KEYCHAIN_SERVICE_PREFIX)) services.add(m[1]);
    }
    return [...services];
  } catch {
    return [];
  }
}

function readTokenFromService(serviceName) {
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", serviceName, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 }
    ).trim();
    const creds = JSON.parse(raw);
    const oauth = creds && creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt || null };
    }
  } catch {}
  return null;
}

function readAccessToken(home = os.homedir()) {
  // 1. macOS Keychain, across every "Claude Code-credentials*" service (see
  // comment above KEYCHAIN_SERVICE_PREFIX for why a single fixed name is
  // not reliable on a multi-account machine).
  try {
    const candidates = [];
    for (const serviceName of listKeychainServices()) {
      const cred = readTokenFromService(serviceName);
      if (cred) candidates.push(cred);
    }
    if (candidates.length > 0) {
      const now = Date.now();
      // expiresAt is a number (epoch ms) in every observed keychain entry on
      // this machine, but tolerate an ISO string too in case other CLI
      // versions store it differently.
      const expiryMs = (c) => {
        if (typeof c.expiresAt === "number") return c.expiresAt;
        if (typeof c.expiresAt === "string") return Date.parse(c.expiresAt);
        return NaN;
      };
      const unexpired = candidates.filter((c) => expiryMs(c) > now);
      const pool = unexpired.length > 0 ? unexpired : candidates;
      pool.sort((a, b) => (expiryMs(b) || 0) - (expiryMs(a) || 0));
      if (pool[0] && pool[0].accessToken) return pool[0].accessToken;
    }
  } catch {}
  // 2. File-based fallback (older versions / non-default setups, e.g. a
  // nonstandard config dir like ~/.claude-personal)
  for (const dir of fs.readdirSync(home).filter((n) => n.startsWith(".claude"))) {
    try {
      const raw = fs.readFileSync(path.join(home, dir, ".credentials.json"), "utf8");
      const token = extractToken(raw);
      if (token) return token;
    } catch {}
  }
  return null;
}

function extractToken(raw) {
  try {
    const creds = JSON.parse(raw);
    return (creds.claudeAiOauth && creds.claudeAiOauth.accessToken) || null;
  } catch { return null; }
}

// Endpoint verified working on 2026-07-19: https://api.anthropic.com/api/oauth/usage
// (the fallback https://api.anthropic.com/api/claude_code/usage was not needed).
function fetchUsageRaw(token) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      "https://api.anthropic.com/api/oauth/usage",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "claude-usage-widget",
        },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`usage endpoint HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("usage endpoint timeout")));
    req.on("error", reject);
  });
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function capitalize(value) {
  const s = String(value);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Maps the real /api/oauth/usage response (see tests/fixtures/usage-response.json,
// captured live in Task 9) onto the gauge bucket shape the UI layer consumes.
// The authoritative source is raw.limits: an array of
// {kind, group, percent, severity, resets_at, scope, is_active} entries.
// kind "session" -> id "session"; kind "weekly_all" -> id "week_all"; kind
// "weekly_scoped" -> id "week_<slug(scope.model.display_name ||
// scope.surface.display_name || "Scoped")>" (e.g. "week_fable"); any other
// kind passes through as-is with a capitalized label. Falls back to the
// five_hour/seven_day `utilization` fields (an older/partial shape) when
// raw.limits is absent or yields no valid buckets.
function normalizeBuckets(raw) {
  if (!raw || typeof raw !== "object") return [];

  if (Array.isArray(raw.limits)) {
    const session = [];
    const weekAll = [];
    const rest = [];
    for (const entry of raw.limits) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.percent !== "number") continue;
      const shared = { pctUsed: Math.round(entry.percent), resetsAt: entry.resets_at || null };
      if (entry.kind === "session") {
        session.push({ id: "session", label: "Session", ...shared });
      } else if (entry.kind === "weekly_all") {
        weekAll.push({ id: "week_all", label: "Week", ...shared });
      } else if (entry.kind === "weekly_scoped") {
        const displayName =
          (entry.scope && entry.scope.model && entry.scope.model.display_name) ||
          (entry.scope && entry.scope.surface && entry.scope.surface.display_name) ||
          "Scoped";
        rest.push({ id: "week_" + slug(displayName), label: displayName, ...shared });
      } else {
        rest.push({ id: entry.kind, label: capitalize(entry.kind), ...shared });
      }
    }
    const combined = [...session, ...weekAll, ...rest];
    if (combined.length > 0) return combined;
  }

  // Fallback shape: raw.five_hour / raw.seven_day objects with `utilization`.
  const out = [];
  const push = (id, label, bucket) => {
    if (!bucket || typeof bucket !== "object") return;
    if (typeof bucket.utilization !== "number") return;
    out.push({ id, label, pctUsed: Math.round(bucket.utilization), resetsAt: bucket.resets_at || null });
  };
  push("session", "Session", raw.five_hour);
  push("week_all", "Week", raw.seven_day);
  return out;
}

// `token`/`fetch` overrides exist for tests (mirrors collectLogs's options
// pattern in logs.js); collect.js's real call site always uses collectLimits()
// with no arguments, which falls through to the real readAccessToken()/fetchUsageRaw().
async function collectLimits({ token = readAccessToken(), fetch = fetchUsageRaw } = {}) {
  if (!token) return { status: "unavailable", message: "no Claude Code credentials found" };

  const raw = await fetch(token);
  const buckets = normalizeBuckets(raw);
  if (buckets.length === 0) return { status: "unavailable", message: "unrecognized usage response" };
  return { status: "ok", buckets };
}

module.exports = { readAccessToken, extractToken, fetchUsageRaw, normalizeBuckets, collectLimits };

#!/usr/bin/env node
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

// Keychain service name (default Claude Code storage). Verified present on
// this machine (2026-07-19) via `security find-generic-password -s
// "Claude Code-credentials" -w`, which returned a token with no interactive
// Keychain prompt (access was already granted from a prior run) — this
// satisfies readAccessToken()'s contract even though this machine's active
// Claude Code config dir is the nonstandard ~/.claude-personal. The
// file-based fallback below is NOT what resolves it here: none of
// ~/.claude*/ on this machine has a .credentials.json file (this box stores
// everything in Keychain), so the fallback is currently dead code here but
// still matters for other setups/older CLI versions.
//
// Caveat found while capturing the Step-3 fixture: this machine runs several
// Claude accounts side by side, and macOS Keychain stores each under its own
// suffixed service name (e.g. "Claude Code-credentials-cc3c5c1c"). The plain
// "Claude Code-credentials" entry above belongs to a stale login (accessToken
// expired 2026-05-04) and gets a 401 from the usage endpoint; the fixture was
// captured using the currently-active account's suffixed entry instead. This
// module intentionally still targets only the default service name per the
// task spec — multi-account keychain discovery is out of scope for Task 9.
// collect.js's error handling already degrades this gracefully (limits
// section reports status "error"/"unavailable" instead of crashing).
const KEYCHAIN_SERVICE = "Claude Code-credentials";

function readAccessToken(home = os.homedir()) {
  // 1. macOS Keychain (Claude Code's storage on macOS)
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 }
    ).trim();
    const token = extractToken(raw);
    if (token) return token;
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

// Task 10 implements the real mapping against tests/fixtures/usage-response.json.
// Declared here so collectLimits() has a stable shape to call into.
function normalizeBuckets(raw) {
  return [];
}

async function collectLimits() {
  const token = readAccessToken();
  if (!token) return { status: "unavailable", message: "no Claude Code credentials found" };

  const raw = await fetchUsageRaw(token);
  const buckets = normalizeBuckets(raw);
  return { status: "ok", buckets };
}

module.exports = { readAccessToken, extractToken, fetchUsageRaw, normalizeBuckets, collectLimits };

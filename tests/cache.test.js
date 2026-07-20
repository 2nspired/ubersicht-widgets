// tests/cache.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { summarizeFileCached, collectLogs } = require("../claude-usage.widget/lib/logs");

function tmpFile(content, mtime) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cuw-")), "s.jsonl");
  fs.writeFileSync(p, content);
  if (mtime) fs.utimesSync(p, mtime, mtime);
  return p;
}

const LINE = JSON.stringify({
  timestamp: "2026-01-01T10:00:00.000Z",
  message: { model: "claude-haiku-4-5", usage: { input_tokens: 7, output_tokens: 0 } },
}) + "\n";

test("summarizeFileCached caches old files by mtime and skips re-read", () => {
  const old = new Date(Date.now() - 3 * 86400e3);
  const p = tmpFile(LINE, old);
  const cache = {};
  const s1 = summarizeFileCached(p, cache);
  assert.ok(cache[p], "cached");
  // mutate the file CONTENT but keep the old mtime — cache should win
  fs.writeFileSync(p, "");
  fs.utimesSync(p, old, old);
  const s2 = summarizeFileCached(p, cache);
  assert.deepEqual(s2, s1);
});

test("summarizeFileCached re-reads files modified today", () => {
  const p = tmpFile(LINE); // mtime = now = today
  const cache = {};
  summarizeFileCached(p, cache);
  assert.equal(cache[p], undefined, "today's files are not cached");
});

test("collectLogs returns unavailable when no dirs exist", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-home-"));
  const s = await collectLogs({ home, cachePath: path.join(home, "cache.json") });
  assert.equal(s.status, "unavailable");
});

test("collectLogs aggregates a fake home tree", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-home-"));
  const dir = path.join(home, ".claude", "projects", "proj-x");
  fs.mkdirSync(dir, { recursive: true });
  const nowLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    message: { model: "claude-haiku-4-5", usage: { input_tokens: 1000000, output_tokens: 0 } },
  }) + "\n";
  fs.writeFileSync(path.join(dir, "a.jsonl"), nowLine);
  const s = await collectLogs({ home, cachePath: path.join(home, "cache.json") });
  assert.equal(s.status, "ok");
  assert.equal(s.today.tokens, 1000000);
  assert.equal(s.today.costUsd, 1); // haiku input $1/MTok
  assert.equal(s.today.sessions, 1);
});

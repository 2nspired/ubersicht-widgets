// tests/cache.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { summarizeFile, summarizeFileCached, collectLogs } = require("../claude-usage.widget/lib/logs");

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

test("summarizeFileCached re-reads when cached entry has a malformed summary shape", () => {
  const old = new Date(Date.now() - 3 * 86400e3);
  const p = tmpFile(LINE, old);
  const mtimeMs = fs.statSync(p).mtimeMs;
  const cache = { [p]: { mtimeMs, summary: {} } }; // malformed: no .days
  const s = summarizeFileCached(p, cache);
  assert.ok(s.days, "should re-read and return a correct summary shape");
  assert.deepEqual(s, summarizeFile(p));
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

test("collectLogs prunes stale cache entries for files no longer present", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-home-"));
  const dir = path.join(home, ".claude", "projects", "proj-x");
  fs.mkdirSync(dir, { recursive: true });
  const nowLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    message: { model: "claude-haiku-4-5", usage: { input_tokens: 1000000, output_tokens: 0 } },
  }) + "\n";
  fs.writeFileSync(path.join(dir, "a.jsonl"), nowLine);

  const cachePath = path.join(home, "cache.json");
  const staleKey = path.join(dir, "deleted-file.jsonl");
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify({ [staleKey]: { mtimeMs: 1, summary: { days: {} } } })
  );

  await collectLogs({ home, cachePath });

  const saved = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.ok(!(staleKey in saved), "stale cache key for deleted file should be pruned");
});

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeBuckets, collectLimits } = require("../claude-usage.widget/lib/limits");
const fixture = require("./fixtures/usage-response.json");

function tmpCachePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-limits-cache-"));
  return path.join(dir, "limits.json");
}

function writeCache(cachePath, fetchedAt, result) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt, result }));
}

// Redirect the default cache location (used by tests below that don't pass
// opts.cachePath explicitly) into a *fresh* isolated temp dir before every
// test, so running the suite never reads/writes the developer's real
// ~/.cache/claude-usage-widget/limits.json, and so that a cache file written
// by one test (e.g. a successful-fetch test) can never leak into and be
// read as a "fresh cache hit" by an unrelated test that runs after it.
beforeEach(() => {
  process.env.CLAUDE_USAGE_WIDGET_CACHE_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "cuw-limits-default-cache-")
  );
});

test("normalizeBuckets maps the real captured response", () => {
  const buckets = normalizeBuckets(fixture);
  assert.equal(buckets.length, 3);
  assert.deepEqual(buckets[0], {
    id: "session",
    label: "Session",
    pctUsed: 54,
    resetsAt: "2026-07-20T02:29:59.765156+00:00",
  });
  const week = buckets.find((b) => b.id === "week_all");
  assert.ok(week);
  assert.equal(week.pctUsed, 19);
  for (const b of buckets) {
    assert.ok(Number.isInteger(b.pctUsed) && b.pctUsed >= 0 && b.pctUsed <= 100);
    assert.ok("resetsAt" in b);
  }
});

test("normalizeBuckets includes a Fable weekly-scoped bucket", () => {
  const buckets = normalizeBuckets(fixture);
  const fable = buckets.find((b) => b.id === "week_fable");
  assert.ok(fable, "this account has a Fable-scoped weekly bucket");
  assert.equal(fable.label, "Fable");
  assert.equal(fable.pctUsed, 35);
});

test("normalizeBuckets orders session, then week_all, then the rest", () => {
  const buckets = normalizeBuckets(fixture);
  assert.deepEqual(buckets.map((b) => b.id), ["session", "week_all", "week_fable"]);
});

test("normalizeBuckets tolerates missing/empty input", () => {
  assert.deepEqual(normalizeBuckets({}), []);
  assert.deepEqual(normalizeBuckets(null), []);
  assert.deepEqual(normalizeBuckets("not an object"), []);
});

test("normalizeBuckets falls back to five_hour/seven_day when limits is absent", () => {
  const buckets = normalizeBuckets({
    five_hour: { utilization: 22, resets_at: "X" },
    seven_day: { utilization: 13, resets_at: "Y" },
  });
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets[0], { id: "session", label: "Session", pctUsed: 22, resetsAt: "X" });
  assert.deepEqual(buckets[1], { id: "week_all", label: "Week", pctUsed: 13, resetsAt: "Y" });
});

test("normalizeBuckets fallback skips absent sections", () => {
  const buckets = normalizeBuckets({ five_hour: { utilization: 22, resets_at: "X" } });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].id, "session");
});

test("normalizeBuckets fallback yields nothing when limits array is empty", () => {
  assert.deepEqual(normalizeBuckets({ limits: [] }), []);
});

test("collectLimits reports unavailable with no token", async () => {
  const result = await collectLimits({ token: null });
  assert.deepEqual(result, { status: "unavailable", message: "no Claude Code credentials found" });
});

test("collectLimits reports ok with normalized buckets on a successful fetch", async () => {
  const result = await collectLimits({
    token: "fake-token",
    fetch: async (token) => {
      assert.equal(token, "fake-token");
      return fixture;
    },
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.buckets.map((b) => b.id), ["session", "week_all", "week_fable"]);
});

test("collectLimits reports unavailable when the response yields no buckets", async () => {
  const result = await collectLimits({ token: "fake-token", fetch: async () => ({}) });
  assert.deepEqual(result, { status: "unavailable", message: "unrecognized usage response" });
});

test("collectLimits short-circuits to unavailable when CLAUDE_USAGE_WIDGET_NO_KEYCHAIN=1, without touching keychain/network", async () => {
  // No token/fetch overrides are passed here on purpose: the point of this
  // test is that collectLimits() called exactly the way collect.js calls it
  // in production (no args) never reaches readAccessToken() or the real
  // fetchUsageRaw() when the env seam is set. If it did, this test would
  // either hang/timeout or prompt for Keychain access instead of resolving
  // fast and deterministically.
  const prev = process.env.CLAUDE_USAGE_WIDGET_NO_KEYCHAIN;
  process.env.CLAUDE_USAGE_WIDGET_NO_KEYCHAIN = "1";
  try {
    const result = await collectLimits();
    assert.deepEqual(result, { status: "unavailable", message: "credentials disabled by env" });
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_USAGE_WIDGET_NO_KEYCHAIN;
    else process.env.CLAUDE_USAGE_WIDGET_NO_KEYCHAIN = prev;
  }
});

test("collectLimits returns a fresh cache hit without touching fetch", async () => {
  const cachePath = tmpCachePath();
  const now = 1_000_000_000;
  const cachedResult = { status: "ok", buckets: [{ id: "session", label: "Session", pctUsed: 10, resetsAt: "X" }] };
  writeCache(cachePath, now - 60_000, cachedResult); // 60s old, well within default 300s ttl

  const result = await collectLimits({
    cachePath,
    now,
    token: "should-not-be-used",
    fetch: async () => { throw new Error("fetch should not be called on a fresh cache hit"); },
  });

  assert.deepEqual(result, { ...cachedResult, cached: true });
});

test("collectLimits falls back to a stale cache when the cache is expired and the live fetch fails", async () => {
  const cachePath = tmpCachePath();
  const now = 1_000_000_000;
  const cachedResult = { status: "ok", buckets: [{ id: "session", label: "Session", pctUsed: 42, resetsAt: "X" }] };
  writeCache(cachePath, now - 10 * 60_000, cachedResult); // 10 minutes old, past the 300s ttl

  const result = await collectLimits({
    cachePath,
    now,
    ttlSeconds: 300,
    token: "fake-token",
    fetch: async () => { throw new Error("network down"); },
  });

  assert.deepEqual(result, { ...cachedResult, cached: true, stale: true });
});

test("collectLimits refreshes and overwrites an expired cache on a successful fetch", async () => {
  const cachePath = tmpCachePath();
  const now = 1_000_000_000;
  const staleResult = { status: "ok", buckets: [{ id: "session", label: "Session", pctUsed: 1, resetsAt: "old" }] };
  writeCache(cachePath, now - 10 * 60_000, staleResult);

  const result = await collectLimits({
    cachePath,
    now,
    ttlSeconds: 300,
    token: "fake-token",
    fetch: async () => fixture,
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.buckets.map((b) => b.id), ["session", "week_all", "week_fable"]);
  assert.equal(result.cached, undefined);

  const onDisk = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(onDisk.fetchedAt, now);
  assert.deepEqual(onDisk.result.buckets.map((b) => b.id), ["session", "week_all", "week_fable"]);
});

test("collectLimits with no prior cache and a failure stays unavailable (no stale fallback to invent)", async () => {
  const cachePath = tmpCachePath(); // fresh temp dir, no file written
  const now = 1_000_000_000;

  const noToken = await collectLimits({ cachePath, now, token: null });
  assert.deepEqual(noToken, { status: "unavailable", message: "no Claude Code credentials found" });

  const emptyBuckets = await collectLimits({
    cachePath,
    now,
    token: "fake-token",
    fetch: async () => ({}),
  });
  assert.deepEqual(emptyBuckets, { status: "unavailable", message: "unrecognized usage response" });
});

test("collectLimits honors CLAUDE_USAGE_WIDGET_CACHE_DIR when opts.cachePath is omitted", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-limits-envdir-"));
  const prev = process.env.CLAUDE_USAGE_WIDGET_CACHE_DIR;
  process.env.CLAUDE_USAGE_WIDGET_CACHE_DIR = dir;
  try {
    const result = await collectLimits({
      now: 1_000_000_000,
      token: "fake-token",
      fetch: async () => fixture,
    });
    assert.equal(result.status, "ok");
    assert.ok(fs.existsSync(path.join(dir, "limits.json")), "cache file written under env-provided dir");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_USAGE_WIDGET_CACHE_DIR;
    else process.env.CLAUDE_USAGE_WIDGET_CACHE_DIR = prev;
  }
});

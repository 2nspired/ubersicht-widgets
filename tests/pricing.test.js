// tests/pricing.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { costUsd, buildLogsSection, localDayKey } = require("../claude-usage.widget/lib/logs");
const pricing = require("../claude-usage.widget/lib/pricing.json");

test("costUsd prices each token class per MTok", () => {
  const sums = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite5m: 0, cacheWrite1h: 1e6 };
  // fable: 10 + 50 + 1 + 20 = 81
  assert.equal(costUsd("claude-fable-5", sums, pricing), 81);
});

test("costUsd returns null for unknown models", () => {
  assert.equal(costUsd("mystery-model", { input: 1e6, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, pricing), null);
});

test("buildLogsSection aggregates today, week, models, sessions", () => {
  const now = new Date("2026-07-19T15:00:00");
  const today = localDayKey(now);
  const yesterday = localDayKey(new Date("2026-07-18T15:00:00"));
  const mk = (input) => ({ input, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  const fileA = { days: { [today]: { models: { "claude-fable-5": mk(1e6) } }, [yesterday]: { models: { "claude-fable-5": mk(2e6) } } } };
  const fileB = { days: { [yesterday]: { models: { "claude-haiku-4-5": mk(1e6) } } } };
  const s = buildLogsSection([fileA, fileB], now, pricing);
  assert.equal(s.status, "ok");
  assert.equal(s.today.tokens, 1e6);
  assert.equal(s.today.costUsd, 10);
  assert.equal(s.today.sessions, 1); // only fileA has activity today
  assert.equal(s.week.days.length, 7);
  assert.equal(s.week.days[6].date, today);
  assert.equal(s.week.costUsd, 10 + 20 + 1); // today fable 10 + yest fable 20 + yest haiku 1
  assert.deepEqual(s.models.map((m) => m.model), ["claude-fable-5"]); // today only
});

// tests/logs.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { parseLine, summarizeFile } = require("../claude-usage.widget/lib/logs");

const FIX = (f) => path.join(__dirname, "fixtures", f);

test("parseLine extracts usage; cache_creation split wins over legacy field", () => {
  const line = JSON.stringify({
    timestamp: "2026-07-19T10:00:00.000Z",
    message: { model: "claude-fable-5", usage: {
      input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3,
      cache_creation_input_tokens: 500,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 400 },
    }},
  });
  const e = parseLine(line);
  assert.equal(e.model, "claude-fable-5");
  assert.equal(e.cacheWrite5m, 100);
  assert.equal(e.cacheWrite1h, 400);
});

test("parseLine without cache_creation treats legacy total as 5m", () => {
  const line = JSON.stringify({
    timestamp: "2026-07-19T10:00:00.000Z",
    message: { model: "m", usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 300 } },
  });
  const e = parseLine(line);
  assert.equal(e.cacheWrite5m, 300);
  assert.equal(e.cacheWrite1h, 0);
});

test("parseLine returns null for malformed or non-usage lines", () => {
  assert.equal(parseLine("{not json"), null);
  assert.equal(parseLine(JSON.stringify({ timestamp: "2026-07-19T00:00:00Z", message: { role: "user" } })), null);
});

test("summarizeFile groups by local day and model, skipping bad lines", () => {
  const s = summarizeFile(FIX("session-a.jsonl"));
  const day19 = Object.keys(s.days).find((d) => d.endsWith("-19") || d.endsWith("-18"));
  assert.ok(day19, "has at least one day bucket");
  const allModels = Object.values(s.days).flatMap((d) => Object.keys(d.models));
  assert.ok(allModels.includes("claude-fable-5"));
  assert.ok(allModels.includes("claude-haiku-4-5"));
  const fableTotals = Object.values(s.days)
    .map((d) => d.models["claude-fable-5"])
    .filter(Boolean)
    .reduce((a, m) => a + m.input, 0);
  assert.equal(fableTotals, 110); // 100 (day 19 UTC) + 10 (day 18 UTC)
});

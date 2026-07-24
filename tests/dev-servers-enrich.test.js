// tests/dev-servers-enrich.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const {
  parseEtime, formatAge, parseGitHead, findProjectRoot, parsePs, parseCwds, parseTunnels,
} = require("../dev-servers.widget/lib/enrich");

test("parseEtime handles mm:ss, hh:mm:ss, d-hh:mm:ss", () => {
  assert.equal(parseEtime("05:30"), 330);
  assert.equal(parseEtime("02:05:30"), 7530);
  assert.equal(parseEtime("3-02:05:30"), 3 * 86400 + 7530);
  assert.equal(parseEtime("garbage"), null);
});

test("formatAge picks the largest sensible unit", () => {
  assert.equal(formatAge(45), "45s");
  assert.equal(formatAge(2700), "45m");
  assert.equal(formatAge(7200), "2h");
  assert.equal(formatAge(3 * 86400 + 100), "3d");
  assert.equal(formatAge(null), "");
});

test("parseGitHead returns branch for ref, short sha for detached, null otherwise", () => {
  assert.equal(parseGitHead("ref: refs/heads/main\n"), "main");
  assert.equal(parseGitHead("ref: refs/heads/fix/auth-flow\n"), "fix/auth-flow");
  assert.equal(parseGitHead("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n"), "a1b2c3d");
  assert.equal(parseGitHead("weird"), null);
});

test("findProjectRoot walks up to nearest .git/package.json, never past HOME or /", () => {
  const home = "/Users/me";
  const existing = new Set(["/Users/me/Projects/acme/.git", "/Users/me/package.json"]);
  const exists = (p) => existing.has(p);
  assert.equal(findProjectRoot("/Users/me/Projects/acme/src/deep", { exists, home }), "/Users/me/Projects/acme");
  // HOME itself is never a project root even though it has package.json:
  assert.equal(findProjectRoot("/Users/me/Downloads", { exists, home }), null);
  assert.equal(findProjectRoot("/opt/nowhere", { exists, home }), null);
});

test("parsePs maps pid to age/cpu/mem (rss KB -> MB)", () => {
  const out = "  344 02:00:00  1.2 215040\n  700 3-00:00:00  0.0  98304\n";
  const m = parsePs(out);
  assert.deepEqual(m.get(344), { ageSeconds: 7200, cpu: 1.2, memMb: 210 });
  assert.equal(m.get(700).memMb, 96);
  assert.equal(m.get(700).ageSeconds, 3 * 86400);
});

test("parseCwds maps pid to cwd path from lsof -Fpn output", () => {
  const out = "p344\nn/Users/me/Projects/acme\np700\nn/Users/me/Projects/other\n";
  const m = parseCwds(out);
  assert.equal(m.get(344), "/Users/me/Projects/acme");
  assert.equal(m.get(700), "/Users/me/Projects/other");
});

test("parseTunnels finds known tunnel binaries by basename only", () => {
  const out = "  333 /opt/homebrew/bin/ngrok\n  334 /usr/local/bin/cloudflared\n  335 /Users/me/bin/stripe\n  336 /usr/bin/grep\n";
  const t = parseTunnels(out);
  assert.deepEqual(t.map((x) => x.command), ["ngrok", "cloudflared", "stripe"]);
  assert.equal(t[0].pid, 333);
});

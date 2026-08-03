"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { findProjectRoot, parseCwds } = require("../lib/project.js");

test("findProjectRoot walks up to the nearest .git or package.json", () => {
  const home = "/Users/me";
  const exists = (p) => p === "/Users/me/Projects/acme/.git";
  assert.equal(findProjectRoot("/Users/me/Projects/acme/src/deep", { exists, home }),
    "/Users/me/Projects/acme");
});

test("findProjectRoot stops at HOME and at /", () => {
  const home = "/Users/me";
  const exists = () => false;
  assert.equal(findProjectRoot("/Users/me/Downloads", { exists, home }), null);
  assert.equal(findProjectRoot("/opt/nowhere", { exists, home }), null);
});

test("findProjectRoot tolerates empty or null input", () => {
  const exists = () => false;
  assert.equal(findProjectRoot("", { exists, home: "/Users/me" }), null);
  assert.equal(findProjectRoot(null, { exists, home: "/Users/me" }), null);
});

test("parseCwds maps pids to working directories", () => {
  // lsof -Fpn emits alternating p<pid> / n<path> records.
  const out = "p111\nn/Users/me/Projects/acme\np222\nn/Users/me/Projects/beta\n";
  const map = parseCwds(out);
  assert.equal(map.get(111), "/Users/me/Projects/acme");
  assert.equal(map.get(222), "/Users/me/Projects/beta");
  assert.equal(map.size, 2);
});

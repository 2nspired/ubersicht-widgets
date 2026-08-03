"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// dimmer.widget has no lib/ to unit-test — index.jsx imports "uebersicht"
// and this repo deliberately has no JSX test harness. What's cheap and
// worth guarding is the shipped config.json itself: that it parses, that it
// carries exactly the keys index.jsx's sanitizers expect, and that the
// default values are already inside the ranges those sanitizers accept —
// so a bad edit to the file (not just to index.jsx) would fail CI.
const configPath = path.join(__dirname, "..", "dimmer.widget", "config.json");

test("dimmer.widget/config.json parses as JSON", () => {
  const raw = fs.readFileSync(configPath, "utf8");
  assert.doesNotThrow(() => JSON.parse(raw));
});

test("dimmer.widget/config.json has exactly the expected keys", () => {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepStrictEqual(Object.keys(config).sort(), ["amount", "color", "filter"]);
});

test("amount is a finite number within [0, 1]", () => {
  const { amount } = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(typeof amount, "number");
  assert.ok(isFinite(amount), "amount must be finite");
  assert.ok(amount >= 0 && amount <= 1, "amount must be within [0, 1]");
});

test("color is an 'r, g, b' triple with each channel a valid byte", () => {
  const { color } = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(typeof color, "string");
  const parts = color.split(",").map((part) => Number(part.trim()));
  assert.equal(parts.length, 3);
  for (const channel of parts) {
    assert.ok(Number.isFinite(channel), "channel must be a finite number");
    assert.ok(channel >= 0 && channel <= 255, "channel must be within [0, 255]");
  }
});

test("filter is null or a non-empty string", () => {
  const { filter } = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.ok(filter === null || (typeof filter === "string" && filter.trim().length > 0));
});

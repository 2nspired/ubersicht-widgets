"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const h = require("../system.widget/lib/history.js");

const S = (t, cpu) => ({ t, cpu, mem: 50, gpu: 0 });

test("trimHistory drops entries older than the window", () => {
  const now = 1000000;
  const entries = [S(now - 400000, 10), S(now - 100000, 20), S(now, 30)];
  const kept = h.trimHistory(entries, now, 300000); // 5-minute window
  assert.equal(kept.length, 2);
  assert.equal(kept[0].cpu, 20);
});

test("trimHistory trims by timestamp, not by count", () => {
  // A machine that slept has few entries but they are ancient — a count-based
  // cap would keep them and draw a line across the gap.
  const now = 1000000;
  const entries = [S(now - 999999, 90), S(now, 10)];
  assert.deepEqual(h.trimHistory(entries, now, 300000).map((e) => e.cpu), [10]);
});

test("trimHistory handles an empty or absent ring", () => {
  assert.deepEqual(h.trimHistory([], 1000, 300000), []);
  assert.deepEqual(h.trimHistory(null, 1000, 300000), []);
});

test("appendSample adds and trims in one step", () => {
  const now = 1000000;
  const entries = [S(now - 400000, 90)];
  const out = h.appendSample(entries, S(now, 12), 300000);
  assert.deepEqual(out.map((e) => e.cpu), [12]);
});

test("isDiscontinuity flags gaps over 30 seconds", () => {
  assert.equal(h.isDiscontinuity(1000, 1000 + 3000), false);
  assert.equal(h.isDiscontinuity(1000, 1000 + 31000), true);
  assert.equal(h.isDiscontinuity(null, 5000), true, "no previous sample is a discontinuity");
});

test("detectSpike returns null when nothing crossed the threshold", () => {
  const now = 300000;
  const entries = [S(now - 6000, 20), S(now - 3000, 30), S(now, 25)];
  assert.equal(h.detectSpike(entries, { percent: 70, seconds: 15 }, now), null);
});

test("detectSpike ignores a burst shorter than the required duration", () => {
  const now = 300000;
  // 2 samples x 3s = 6s above threshold, under the 15s requirement
  const entries = [S(now - 9000, 20), S(now - 6000, 95), S(now - 3000, 92), S(now, 20)];
  assert.equal(h.detectSpike(entries, { percent: 70, seconds: 15 }, now), null);
});

test("detectSpike reports peak, duration and how long ago it ended", () => {
  const now = 300000;
  const entries = [
    S(now - 30000, 20), S(now - 27000, 95), S(now - 24000, 98),
    S(now - 21000, 91), S(now - 18000, 88), S(now - 15000, 90),
    S(now - 12000, 22), S(now - 9000, 20), S(now - 6000, 21), S(now, 22),
  ];
  const spike = h.detectSpike(entries, { percent: 70, seconds: 15 }, now);
  assert.ok(spike, "expected a spike");
  assert.equal(spike.peak, 98);
  assert.equal(spike.aboveSeconds, 15); // 5 samples x 3s
  assert.equal(spike.active, false);
  assert.equal(spike.endedSecondsAgo, 12);
});

test("detectSpike marks an in-progress spike active with endedSecondsAgo 0", () => {
  const now = 300000;
  const entries = [
    S(now - 18000, 20), S(now - 15000, 95), S(now - 12000, 96),
    S(now - 9000, 97), S(now - 6000, 93), S(now - 3000, 91), S(now, 94),
  ];
  const spike = h.detectSpike(entries, { percent: 70, seconds: 15 }, now);
  assert.ok(spike);
  assert.equal(spike.active, true);
  assert.equal(spike.endedSecondsAgo, 0);
  assert.equal(spike.peak, 97);
});

test("detectSpike sums non-contiguous time above the threshold", () => {
  const now = 300000;
  const entries = [
    S(now - 30000, 95), S(now - 27000, 95), S(now - 24000, 20),
    S(now - 21000, 95), S(now - 18000, 95), S(now - 15000, 95), S(now, 20),
  ];
  // The oldest entry (now-30000) is above threshold but credits no time —
  // nothing is known about the period before it. Four 3s intervals are
  // credited instead (the gap into each above-threshold reading at
  // now-27000, now-21000, now-18000 and now-15000), summing to 12s, not 15s.
  const spike = h.detectSpike(entries, { percent: 70, seconds: 9 }, now);
  assert.ok(spike, "cumulative 12s should qualify even when interrupted");
  assert.equal(spike.aboveSeconds, 12);
});

test("detectSpike never double-counts the interval when the first two samples are both above threshold", () => {
  const now = 300000;
  const entries = [
    S(now - 15000, 95), S(now - 10000, 96), S(now - 5000, 20), S(now, 20),
  ];
  const spike = h.detectSpike(entries, { percent: 70, seconds: 5 }, now);
  assert.ok(spike, "expected a spike");
  // Only the now-15000..now-10000 interval is credited (5s): entries[0] is
  // the oldest sample and contributes nothing, since nothing is known about
  // what happened before it.
  assert.equal(spike.aboveSeconds, 5);
  const span = entries[entries.length - 1].t - entries[0].t;
  assert.ok(spike.aboveSeconds * 1000 <= span, "aboveSeconds must never exceed the sample set's elapsed span");
});

test("detectSpike copes with fewer than two samples", () => {
  assert.equal(h.detectSpike([], { percent: 70, seconds: 15 }, 1000), null);
  assert.equal(h.detectSpike([S(1000, 99)], { percent: 70, seconds: 15 }, 1000), null);
});

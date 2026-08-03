"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const COLLECT = path.join(__dirname, "..", "system.widget", "lib", "collect.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sysw-atomic-"));
}

// A standalone writer script (not requiring test-runner internals) that
// `require()`s the real collect.js module and hammers writeCache() with
// varying-size payloads. Run as its own process so it races the reader (and
// other writers) for real, at the OS level — a single Node process can't
// produce a genuine write/read race against itself because sync fs calls
// block its own event loop.
function writerScript(cacheEnvPath) {
  return `
    process.env.UBERSICHT_SYSTEM_WIDGET_CACHE = ${JSON.stringify(cacheEnvPath)};
    const { writeCache } = require(${JSON.stringify(COLLECT)});
    const iterations = parseInt(process.argv[2], 10);
    const tag = process.argv[3];
    for (let i = 0; i < iterations; i++) {
      const n = 200 + (i % 6) * 600; // 200..3200 entries: deliberately uneven sizes
      const sample = [];
      for (let j = 0; j < n; j++) {
        sample.push([j, j * 0.013, "/Applications/" + tag + "App" + j + ".app/Contents/MacOS/" + tag + "Helper" + j]);
      }
      writeCache({ at: Date.now(), sample, history: [], tag, i });
    }
  `;
}

function runWriter(dir, cachePath, iterations, tag) {
  const scriptPath = path.join(dir, `writer-${tag}.js`);
  fs.writeFileSync(scriptPath, writerScript(cachePath));
  const child = spawn(process.execPath, [scriptPath, String(iterations), tag], {
    stdio: "ignore",
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer ${tag} exited ${code}`))));
  });
}

test("concurrent cache writes never produce a torn/partial file for a reader", async () => {
  const dir = tmpDir();
  const cache = path.join(dir, "history.json");

  const writers = [
    runWriter(dir, cache, 60, "a"),
    runWriter(dir, cache, 60, "b"),
    runWriter(dir, cache, 60, "c"),
  ];

  const parseErrors = [];
  let successfulReads = 0;
  let done = false;
  // Settle `done` on either success or failure so the read loop below can
  // never hang if a writer process errors out; the actual writer outcome is
  // still checked via `await Promise.all(writers)` after the loop.
  Promise.all(writers).then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );

  // Tight read loop racing the writers above. Every read must either fail
  // with ENOENT (file doesn't exist yet) or parse as one complete,
  // well-formed JSON document. Anything else (JSON.parse throwing
  // "Unexpected end of JSON input" or "Extra data"-style errors) is a torn
  // read: proof the write was not atomic.
  //
  // The read itself (fs.readFileSync) stays synchronous to keep the race
  // window as tight as possible, but the loop yields to the event loop via
  // setImmediate between iterations — without that, this loop would never
  // return control to Node, and the writer child processes' `exit` events
  // (which is how `done` gets set, and how Node reaps them at all) would
  // never be delivered: a self-inflicted deadlock, not a race.
  while (!done) {
    try {
      const raw = fs.readFileSync(cache, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.sample) || !Array.isArray(parsed.history)) {
        parseErrors.push("parsed but wrong shape: " + raw.slice(0, 80));
      } else {
        successfulReads++;
      }
    } catch (err) {
      if (err.code === "ENOENT") {
        // File not created yet — acceptable, not a torn read.
      } else {
        parseErrors.push(String(err && err.message));
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }

  await Promise.all(writers);

  assert.equal(
    parseErrors.length,
    0,
    `observed ${parseErrors.length} torn/invalid read(s), e.g.: ${parseErrors.slice(0, 3).join(" | ")}`
  );
  assert.ok(successfulReads > 0, "sanity: the race window should have produced at least some successful reads");

  // The file left behind after every writer finishes must itself be
  // complete, valid JSON — a valid cache must never be left corrupted by a
  // write that was interrupted or raced.
  const finalRaw = fs.readFileSync(cache, "utf8");
  const finalParsed = JSON.parse(finalRaw);
  assert.ok(Array.isArray(finalParsed.sample));

  // No abandoned temp files should be left behind on the success path —
  // rename() consumes the temp file on every successful write.
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], `unexpected leftover temp file(s): ${leftovers.join(", ")}`);
});

// The regression this branch shipped with: a torn cache (valid JSON followed
// by leftover tail bytes from a previous, longer write — exactly the
// `Extra data: line 1 column N` failure observed live) must degrade to
// first-run behaviour, not crash the collector or emit anything but one
// valid JSON object.
test("a torn (truncated-with-trailing-garbage) cache degrades to first-run and still emits valid JSON", () => {
  const dir = tmpDir();
  const cache = path.join(dir, "history.json");

  const validPrefix = JSON.stringify({
    at: Date.now(),
    sample: [[1, 2, "/usr/bin/tornprefix"]],
    history: [],
  });
  // Simulate a shorter write landing on top of a longer previous write: the
  // valid JSON document is immediately followed by leftover tail bytes.
  fs.writeFileSync(cache, validPrefix + '","comm":"leftover-tail-from-a-longer-previous-write"}');

  const out = execFileSync(process.execPath, [COLLECT], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { UBERSICHT_SYSTEM_WIDGET_CACHE: cache }),
  });

  // Must be exactly one parseable JSON object on stdout.
  const d = JSON.parse(out);
  assert.equal(d.status, "ok");
  assert.equal(d.cpuEstimated, true, "a torn cache must degrade to the first-run estimated path");
  assert.ok(Array.isArray(d.history));
});

# Dev Servers Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Übersicht corner-card widget listing every dev server running on the machine — project name, port, command, branch, uptime, cpu/mem, health dot.

**Architecture:** A `dev-servers.widget/` sibling to `claude-usage.widget`: `run.sh` finds Node and execs `lib/collect.js`, which scans via `lsof`/`docker ps`/`ps`, enriches rows, and prints one JSON payload. `index.jsx` renders only. All parsing lives in pure functions in `lib/` modules, unit-tested against fixtures.

**Tech Stack:** Node.js (CommonJS, no dependencies), `node --test`, Übersicht JSX (`uebersicht` css import), macOS `lsof`/`ps`/`docker` CLIs.

**Spec:** `docs/superpowers/specs/2026-07-23-dev-servers-widget-design.md`

## Global Constraints

- macOS only; runs as the logged-in user; no sudo, no writes, display-only.
- All external commands via `execFile`/`execFileSync` with fixed argv arrays — never `exec` or string-built shells. PIDs are validated integers before use as arguments.
- Network access is `127.0.0.1` only; per-probe timeout 300ms; global collector watchdog 5s; per-command timeout 4s.
- Collector always exits 0 and always prints exactly one JSON document to stdout (`JSON.stringify`), even on failure (`{"status":"error",...}`).
- CommonJS (`"use strict"`, `require`) matching `package.json` `"type": "commonjs"`. Tests use `node:test` + `node:assert` in `tests/`, fixtures in `tests/fixtures/`. `npm test` glob (`node --test tests/**/*.test.js`) picks new tests up automatically.
- `refreshFrequency` in `index.jsx` is 10000 (ms), kept in sync with `config.json` `refreshSeconds: 10` by convention.
- Widget hidden entirely when no servers survive filtering; `maxRows` default 12 with `+N more` footer; `staleHours` default 24 renders uptime amber.
- `index.jsx` must not use nullish coalescing (`??`) or optional chaining (`?.`) — Übersicht's bundled Babel cannot parse them (see commit `a80ea11`). Node-side `lib/` code may use them freely.

---

### Task 1: Port scan parsing and noise filter (`ports.js`)

**Files:**
- Create: `dev-servers.widget/lib/ports.js`
- Create: `tests/fixtures/lsof-listen.txt`
- Test: `tests/dev-servers-ports.test.js`

**Interfaces:**
- Consumes: nothing (pure functions over strings).
- Produces:
  - `parseLsof(text: string) -> Array<{pid: number, command: string, port: number}>` — parses `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` field output.
  - `dedupe(rows) -> Array<{pid, command, port, ports: number[]}>` — one row per pid, `ports` sorted ascending, `port` = lowest.
  - `filterNoise(rows, config?: {ignoreProcesses?: string[], ignorePorts?: number[]}) -> rows` — drops denylisted commands/ports.
  - `DENY_PROCESSES: string[]`, `DENY_PORTS: number[]` (exported for tests).

- [ ] **Step 1: Write the failing tests**

Create `tests/fixtures/lsof-listen.txt` — captured shape of `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` (`p`=pid, `c`=command, `f`=fd, `n`=name; one `n` per listening socket):

```
p344
cnode
f23
n*:3000
f24
n*:3000
p400
cGoogle Chrome
f45
n127.0.0.1:9222
p512
cpostgres
f7
n127.0.0.1:5432
p600
cControlCe
f9
n*:7000
p700
cnode
f21
n[::1]:8080
f22
nlocalhost:8081
```

Create `tests/dev-servers-ports.test.js`:

```js
// tests/dev-servers-ports.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseLsof, dedupe, filterNoise } = require("../dev-servers.widget/lib/ports");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "lsof-listen.txt"), "utf8");

test("parseLsof extracts pid/command/port from -Fpcn output, incl. IPv6 and spaced names", () => {
  const rows = parseLsof(FIXTURE);
  assert.deepEqual(rows[0], { pid: 344, command: "node", port: 3000 });
  assert.ok(rows.some((r) => r.pid === 400 && r.command === "Google Chrome" && r.port === 9222));
  assert.ok(rows.some((r) => r.pid === 700 && r.port === 8080)); // [::1]:8080
  assert.ok(rows.some((r) => r.pid === 700 && r.port === 8081)); // localhost:8081
});

test("parseLsof skips garbage lines and port-less names", () => {
  assert.deepEqual(parseLsof("junk\np12\ncfoo\nn*:invalid\n"), []);
  assert.deepEqual(parseLsof(""), []);
});

test("dedupe collapses double-listings and multi-port pids to one row, lowest port first", () => {
  const rows = dedupe(parseLsof(FIXTURE));
  const node344 = rows.find((r) => r.pid === 344);
  assert.deepEqual(node344.ports, [3000]); // IPv4+IPv6 double-listing collapsed
  const node700 = rows.find((r) => r.pid === 700);
  assert.deepEqual(node700.ports, [8080, 8081]);
  assert.equal(node700.port, 8080);
});

test("filterNoise drops denylisted commands (case-insensitive prefix) and denylisted ports", () => {
  const rows = dedupe(parseLsof(FIXTURE));
  const kept = filterNoise(rows);
  assert.ok(!kept.some((r) => r.command === "Google Chrome"));
  assert.ok(!kept.some((r) => r.command === "ControlCe")); // its only port (7000) is denied too
  assert.ok(kept.some((r) => r.pid === 344));
  assert.ok(kept.some((r) => r.command === "postgres"));
});

test("filterNoise honors config ignoreProcesses and ignorePorts", () => {
  const rows = [
    { pid: 1, command: "node", port: 3000, ports: [3000] },
    { pid: 2, command: "mything", port: 4000, ports: [4000] },
    { pid: 3, command: "node", port: 5555, ports: [5555, 6666] },
  ];
  const kept = filterNoise(rows, { ignoreProcesses: ["MyThing"], ignorePorts: [5555] });
  assert.ok(!kept.some((r) => r.pid === 2));
  const partial = kept.find((r) => r.pid === 3);
  assert.deepEqual(partial.ports, [6666]); // denied port removed, row kept
  assert.equal(partial.port, 6666);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the 5 new tests FAIL with `Cannot find module '../dev-servers.widget/lib/ports'`; existing claude-usage tests still PASS.

- [ ] **Step 3: Write the implementation**

Create `dev-servers.widget/lib/ports.js`:

```js
#!/usr/bin/env node
"use strict";

// Processes that hold ports but are never dev servers. Matched
// case-insensitively as a prefix of lsof's command name (lsof truncates,
// e.g. "ControlCe" for Control Center).
const DENY_PROCESSES = [
  "rapportd", "sharingd", "controlce", "mdnsrespon", "airplay",
  "identitys", "assistantd", "cloudd", "bluetoothd", "remoted",
  "google", "chrome", "safari", "arc", "firefox", "brave", "spotify",
  "dropbox", "onedrive", "creative", "adobe", "logioption", "raycast",
  "uebersicht", "übersicht",
];

// Ports that are always system noise (AirPlay Receiver holds 5000/7000).
const DENY_PORTS = [5000, 7000];

// Parses `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` field output: p<pid>, c<command>,
// f<fd>, n<addr:port>. Field mode is used because the columnar output can't be
// split reliably when command names contain spaces.
function parseLsof(text) {
  const rows = [];
  let pid = null;
  let command = "?";
  for (const line of String(text).split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") {
      pid = Number(val);
      command = "?";
    } else if (tag === "c") {
      command = val;
    } else if (tag === "n" && Number.isInteger(pid)) {
      const port = Number((val.match(/:(\d+)$/) || [])[1]);
      if (Number.isInteger(port)) rows.push({ pid, command, port });
    }
  }
  return rows;
}

function dedupe(rows) {
  const byPid = new Map();
  for (const r of rows) {
    const cur = byPid.get(r.pid);
    if (!cur) {
      byPid.set(r.pid, { pid: r.pid, command: r.command, port: r.port, ports: [r.port] });
    } else if (!cur.ports.includes(r.port)) {
      cur.ports.push(r.port);
      cur.ports.sort((a, b) => a - b);
      cur.port = cur.ports[0];
    }
  }
  return [...byPid.values()];
}

function filterNoise(rows, config = {}) {
  const denyProc = DENY_PROCESSES.concat(
    (config.ignoreProcesses || []).map((s) => String(s).toLowerCase())
  );
  const denyPorts = new Set(DENY_PORTS.concat(config.ignorePorts || []));
  return rows
    .map((r) => {
      const ports = r.ports.filter((p) => !denyPorts.has(p));
      return { ...r, ports, port: ports[0] };
    })
    .filter(
      (r) =>
        r.ports.length > 0 &&
        !denyProc.some((d) => r.command.toLowerCase().startsWith(d))
    );
}

module.exports = { parseLsof, dedupe, filterNoise, DENY_PROCESSES, DENY_PORTS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dev-servers.widget/lib/ports.js tests/dev-servers-ports.test.js tests/fixtures/lsof-listen.txt
git commit -m "feat(dev-servers): lsof port scan parsing, dedupe, noise filter"
```

---

### Task 2: Docker container merge (`docker.js`)

**Files:**
- Create: `dev-servers.widget/lib/docker.js`
- Create: `tests/fixtures/docker-ps.jsonl`
- Test: `tests/dev-servers-docker.test.js`

**Interfaces:**
- Consumes: row shape from Task 1 (`{pid, command, port, ports}`).
- Produces:
  - `parseDockerPs(text: string) -> Array<{name: string, image: string, ports: number[], project: string|null}>` — parses `docker ps --format '{{json .}}'` line output; `ports` are published host ports, sorted; `project` from the `com.docker.compose.project` label.
  - `mergeDocker(rows, containers) -> rows` — removes docker-proxy rows from the scan and appends docker rows shaped `{kind: "docker", command: <image>, name, project, port, ports}` (containers without published ports are omitted).

- [ ] **Step 1: Write the failing tests**

Create `tests/fixtures/docker-ps.jsonl` (shape of `docker ps --format '{{json .}}'`, one JSON object per line; key fields: `Names`, `Image`, `Ports`, `Labels`):

```
{"ID":"aaa111","Names":"acme-api-db-1","Image":"postgres:16","Ports":"0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp","Labels":"com.docker.compose.project=acme-api,com.docker.compose.service=db","State":"running"}
{"ID":"bbb222","Names":"redis-solo","Image":"redis:7","Ports":"127.0.0.1:6379->6379/tcp","Labels":"","State":"running"}
{"ID":"ccc333","Names":"worker-1","Image":"acme/worker:latest","Ports":"","Labels":"com.docker.compose.project=acme-api","State":"running"}
```

Create `tests/dev-servers-docker.test.js`:

```js
// tests/dev-servers-docker.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseDockerPs, mergeDocker } = require("../dev-servers.widget/lib/docker");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "docker-ps.jsonl"), "utf8");

test("parseDockerPs extracts name, image, published ports (deduped), compose project", () => {
  const cs = parseDockerPs(FIXTURE);
  assert.equal(cs.length, 3);
  assert.deepEqual(cs[0], {
    name: "acme-api-db-1",
    image: "postgres:16",
    ports: [5432], // IPv4+IPv6 publish lines dedupe to one port
    project: "acme-api",
  });
  assert.equal(cs[1].project, null);
  assert.deepEqual(cs[2].ports, []); // no published ports
});

test("parseDockerPs skips blank and malformed lines", () => {
  assert.deepEqual(parseDockerPs("\nnot json\n"), []);
  assert.deepEqual(parseDockerPs(""), []);
});

test("mergeDocker replaces docker proxy rows with container rows and drops portless containers", () => {
  const scanned = [
    { pid: 344, command: "node", port: 3000, ports: [3000] },
    { pid: 900, command: "com.docker.backend", port: 5432, ports: [5432] },
    { pid: 901, command: "com.docker.backend", port: 6379, ports: [6379] },
  ];
  const merged = mergeDocker(scanned, parseDockerPs(FIXTURE));
  assert.ok(merged.some((r) => r.pid === 344)); // untouched
  assert.ok(!merged.some((r) => r.command === "com.docker.backend"));
  const pg = merged.find((r) => r.kind === "docker" && r.port === 5432);
  assert.equal(pg.name, "acme-api-db-1");
  assert.equal(pg.project, "acme-api");
  assert.equal(pg.command, "postgres:16");
  assert.ok(!merged.some((r) => r.name === "worker-1")); // no published port
});

test("mergeDocker with no containers is a no-op that still strips docker daemon rows", () => {
  const scanned = [
    { pid: 344, command: "node", port: 3000, ports: [3000] },
    { pid: 900, command: "com.docker.backend", port: 60000, ports: [60000] },
  ];
  const merged = mergeDocker(scanned, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].pid, 344);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: new tests FAIL with `Cannot find module '../dev-servers.widget/lib/docker'`.

- [ ] **Step 3: Write the implementation**

Create `dev-servers.widget/lib/docker.js`:

```js
#!/usr/bin/env node
"use strict";

// Parses `docker ps --format '{{json .}}'` — one JSON object per line.
function parseDockerPs(text) {
  const containers = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let c;
    try {
      c = JSON.parse(line);
    } catch {
      continue;
    }
    const labels = String(c.Labels || "");
    const project = (labels.match(/com\.docker\.compose\.project=([^,]+)/) || [])[1] || null;
    const ports = [
      ...new Set(
        [...String(c.Ports || "").matchAll(/:(\d+)->/g)].map((m) => Number(m[1]))
      ),
    ].sort((a, b) => a - b);
    containers.push({ name: String(c.Names || "?"), image: String(c.Image || "?"), ports, project });
  }
  return containers;
}

// Ports published by containers are held on the host by Docker's proxy
// process, so any scanned row on such a port IS the proxy — replace it with a
// row for the actual container. Docker's own daemon rows are dropped outright.
function mergeDocker(rows, containers) {
  const dockerPorts = new Set(containers.flatMap((c) => c.ports));
  const kept = rows.filter(
    (r) => !/docker|vpnkit/i.test(r.command) && !r.ports.every((p) => dockerPorts.has(p))
  );
  const dockerRows = containers
    .filter((c) => c.ports.length > 0)
    .map((c) => ({
      kind: "docker",
      command: c.image,
      name: c.name,
      project: c.project || c.name,
      port: c.ports[0],
      ports: c.ports,
    }));
  return kept.concat(dockerRows);
}

module.exports = { parseDockerPs, mergeDocker };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dev-servers.widget/lib/docker.js tests/dev-servers-docker.test.js tests/fixtures/docker-ps.jsonl
git commit -m "feat(dev-servers): docker ps parsing and port-to-container attribution"
```

---

### Task 3: Enrichment parsers (`enrich.js`)

**Files:**
- Create: `dev-servers.widget/lib/enrich.js`
- Test: `tests/dev-servers-enrich.test.js`

**Interfaces:**
- Consumes: nothing (pure functions; fs access injectable).
- Produces:
  - `parseEtime(s: string) -> number|null` — seconds from ps `etime` (`mm:ss`, `hh:mm:ss`, `d-hh:mm:ss`).
  - `formatAge(seconds: number|null) -> string` — `"45s"`, `"12m"`, `"2h"`, `"3d"`, `""` for null.
  - `parseGitHead(text: string) -> string|null` — branch name, or 7-char SHA for detached HEAD.
  - `readBranch(projectRoot: string, deps?: {readFile}) -> string|null` — reads `<root>/.git/HEAD`, never throws.
  - `findProjectRoot(cwd: string, deps?: {exists, home}) -> string|null` — nearest ancestor (cwd included) containing `.git` or `package.json`; never matches `$HOME` or `/`.
  - `parsePs(text: string) -> Map<pid, {ageSeconds, cpu, memMb}>` — from `ps -o pid=,etime=,%cpu=,rss= -p ...`.
  - `parseCwds(text: string) -> Map<pid, cwdPath>` — from `lsof -a -p ... -d cwd -Fpn`.
  - `parseTunnels(text: string) -> Array<{kind: "tunnel", pid, command}>` — from `ps -axo pid=,comm=`, matching basenames `ngrok|cloudflared|stripe`.

- [ ] **Step 1: Write the failing tests**

Create `tests/dev-servers-enrich.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: new tests FAIL with `Cannot find module '../dev-servers.widget/lib/enrich'`.

- [ ] **Step 3: Write the implementation**

Create `dev-servers.widget/lib/enrich.js`:

```js
#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const TUNNEL_NAMES = new Set(["ngrok", "cloudflared", "stripe"]);

function parseEtime(s) {
  const m = String(s).trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  const d = Number(m[1]) || 0;
  const h = Number(m[2]) || 0;
  const min = Number(m[3]) || 0;
  const sec = Number(m[4]) || 0;
  return ((d * 24 + h) * 60 + min) * 60 + sec;
}

function formatAge(seconds) {
  if (seconds == null) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function parseGitHead(text) {
  const s = String(text).trim();
  const ref = s.match(/^ref: refs\/heads\/(.+)$/);
  if (ref) return ref[1];
  if (/^[0-9a-f]{40}$/.test(s)) return s.slice(0, 7);
  return null;
}

function readBranch(projectRoot, { readFile = fs.readFileSync } = {}) {
  try {
    return parseGitHead(readFile(path.join(projectRoot, ".git", "HEAD"), "utf8"));
  } catch {
    return null;
  }
}

// Walks up from cwd looking for .git or package.json. Stops at (and never
// matches) $HOME and / — home directories aren't projects, and the walk must
// not escape the user's own tree.
function findProjectRoot(cwd, { exists = fs.existsSync, home = os.homedir() } = {}) {
  let dir = String(cwd || "");
  while (dir && dir !== "/" && dir !== home) {
    if (exists(path.join(dir, ".git")) || exists(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Parses `ps -o pid=,etime=,%cpu=,rss= -p <pids>` output.
function parsePs(text) {
  const map = new Map();
  for (const line of String(text).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)$/);
    if (!m) continue;
    map.set(Number(m[1]), {
      ageSeconds: parseEtime(m[2]),
      cpu: Number(m[3]),
      memMb: Math.round(Number(m[4]) / 1024),
    });
  }
  return map;
}

// Parses `lsof -a -p <pids> -d cwd -Fpn` output: p<pid> then n<path>.
function parseCwds(text) {
  const map = new Map();
  let pid = null;
  for (const line of String(text).split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && Number.isInteger(pid)) map.set(pid, line.slice(1));
  }
  return map;
}

// Parses `ps -axo pid=,comm=` output, keeping known tunnel binaries.
function parseTunnels(text) {
  const rows = [];
  for (const line of String(text).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const base = m[2].trim().split("/").pop().toLowerCase();
    if (TUNNEL_NAMES.has(base)) rows.push({ kind: "tunnel", pid: Number(m[1]), command: base });
  }
  return rows;
}

module.exports = {
  parseEtime, formatAge, parseGitHead, readBranch, findProjectRoot,
  parsePs, parseCwds, parseTunnels,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dev-servers.widget/lib/enrich.js tests/dev-servers-enrich.test.js
git commit -m "feat(dev-servers): enrichment parsers (etime, git HEAD, project root, ps, cwd, tunnels)"
```

---

### Task 4: Health probes (`health.js`)

**Files:**
- Create: `dev-servers.widget/lib/health.js`
- Test: `tests/dev-servers-health.test.js`

**Interfaces:**
- Consumes: port numbers (integers) from earlier tasks.
- Produces:
  - `probePort(port: number, opts?: {timeoutMs?: number, dbPorts?: Set<number>}) -> Promise<"up"|"tcp"|"down">` — `"up"` = any HTTP response (4xx/5xx included); `"tcp"` = accepts TCP but not HTTP; `"down"` = connection refused/timeout.
  - `probeAll(ports: number[], opts?) -> Promise<Map<port, verdict>>` — all probes in parallel.
  - `DB_PORTS: Set<number>` — ports that skip the HTTP attempt (straight to TCP).

- [ ] **Step 1: Write the failing tests**

Create `tests/dev-servers-health.test.js` (uses real servers on ephemeral ports — no mocking, no fixed ports):

```js
// tests/dev-servers-health.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const net = require("node:net");
const { probePort, probeAll } = require("../dev-servers.widget/lib/health");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("probePort reports 'up' for an HTTP server even on a 500 response", async () => {
  const srv = http.createServer((req, res) => { res.statusCode = 500; res.end(); });
  const port = await listen(srv);
  try {
    assert.equal(await probePort(port), "up");
  } finally {
    srv.close();
  }
});

test("probePort reports 'tcp' for a DB-designated port that accepts connections", async () => {
  const srv = net.createServer(() => {}); // accepts, says nothing
  const port = await listen(srv);
  try {
    assert.equal(await probePort(port, { dbPorts: new Set([port]) }), "tcp");
  } finally {
    srv.close();
  }
});

test("probePort reports 'tcp' for a non-HTTP listener (HTTP attempt times out)", async () => {
  const srv = net.createServer(() => {});
  const port = await listen(srv);
  try {
    assert.equal(await probePort(port, { timeoutMs: 150 }), "tcp");
  } finally {
    srv.close();
  }
});

test("probePort reports 'down' for a closed port", async () => {
  const srv = net.createServer();
  const port = await listen(srv);
  await new Promise((r) => srv.close(r)); // port now free
  assert.equal(await probePort(port, { timeoutMs: 150 }), "down");
});

test("probeAll probes in parallel and maps ports to verdicts", async () => {
  const a = http.createServer((req, res) => res.end("ok"));
  const pa = await listen(a);
  try {
    const m = await probeAll([pa]);
    assert.equal(m.get(pa), "up");
  } finally {
    a.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: new tests FAIL with `Cannot find module '../dev-servers.widget/lib/health'`.

- [ ] **Step 3: Write the implementation**

Create `dev-servers.widget/lib/health.js`:

```js
#!/usr/bin/env node
"use strict";
const net = require("net");
const http = require("http");

// Well-known non-HTTP service ports: skip the HTTP attempt, go straight to
// a TCP connect (mysql, postgres x2, redis, kafka, mongo, supabase-local pg).
const DB_PORTS = new Set([3306, 5432, 5433, 6379, 9092, 27017, 54322]);

function tcpCheck(port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

function httpCheck(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: timeoutMs }, (res) => {
      res.destroy(); // status line is all we need; never read the body
      resolve(true); // any HTTP response — even 4xx/5xx — means the server is up
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

async function probePort(port, { timeoutMs = 300, dbPorts = DB_PORTS } = {}) {
  if (dbPorts.has(port)) return (await tcpCheck(port, timeoutMs)) ? "tcp" : "down";
  if (await httpCheck(port, timeoutMs)) return "up";
  return (await tcpCheck(port, timeoutMs)) ? "tcp" : "down";
}

async function probeAll(ports, opts) {
  const verdicts = await Promise.all(ports.map((p) => probePort(p, opts)));
  return new Map(ports.map((p, i) => [p, verdicts[i]]));
}

module.exports = { probePort, probeAll, DB_PORTS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dev-servers.widget/lib/health.js tests/dev-servers-health.test.js
git commit -m "feat(dev-servers): localhost health probes (up/tcp/down)"
```

---

### Task 5: Collector orchestrator (`collect.js`, `run.sh`, `config.json`, `mock.json`)

**Files:**
- Create: `dev-servers.widget/lib/collect.js`
- Create: `dev-servers.widget/lib/run.sh` (mode 755)
- Create: `dev-servers.widget/config.json`
- Create: `dev-servers.widget/lib/mock.json`
- Test: `tests/dev-servers-collect.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–4 (exact exports listed in those tasks).
- Produces (the payload `index.jsx` consumes — single JSON document on stdout):

```
{
  "generatedAt": ISO string,
  "status": "ok" | "error",
  "message": string (only when status = "error"),
  "config": merged config object,
  "servers": [{
    "kind": "process" | "docker" | "tunnel",
    "pid": number | null,          // null for docker rows
    "port": number | null,         // null for portless tunnels
    "ports": number[],
    "command": string,             // process name or docker image
    "name": string | null,         // docker container name
    "project": string | null,
    "branch": string | null,
    "ageSeconds": number | null,
    "age": string,                 // "2h" — "" when unknown
    "stale": boolean,
    "cpu": number | null,
    "memMb": number | null,
    "health": "up" | "tcp" | "down" | "unknown"
  }]
}
```

Servers are sorted by `project` (fallback `command`) then `port` — the renderer does no sorting.

- [ ] **Step 1: Write the failing tests**

Create `tests/dev-servers-collect.test.js`:

```js
// tests/dev-servers-collect.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const COLLECT = path.join(__dirname, "..", "dev-servers.widget", "lib", "collect.js");

test("collect --mock prints a valid payload with servers", () => {
  const out = execFileSync(process.execPath, [COLLECT, "--mock"], { encoding: "utf8" });
  const data = JSON.parse(out);
  assert.equal(data.status, "ok");
  assert.ok(Array.isArray(data.servers) && data.servers.length >= 3);
  assert.ok(data.config.show);
  const kinds = new Set(data.servers.map((s) => s.kind));
  assert.ok(kinds.has("process") && kinds.has("docker") && kinds.has("tunnel"));
});

test("collect live run exits 0 and prints one JSON document, ok or error", () => {
  const out = execFileSync(process.execPath, [COLLECT, "--no-mock"], {
    encoding: "utf8",
    timeout: 15000,
  });
  const data = JSON.parse(out);
  assert.ok(["ok", "error"].includes(data.status));
  assert.ok(Array.isArray(data.servers));
  for (const s of data.servers) {
    if (s.port != null) assert.ok(Number.isInteger(s.port));
    if (s.pid != null) assert.ok(Number.isInteger(s.pid));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: new tests FAIL (`collect.js` missing / mock missing).

- [ ] **Step 3: Write config, mock, run.sh**

Create `dev-servers.widget/config.json`:

```json
{
  "position": { "corner": "top-right" },
  "refreshSeconds": 10,
  "staleHours": 24,
  "maxRows": 12,
  "ignoreProcesses": [],
  "ignorePorts": [],
  "show": { "uptime": true, "health": true, "cpu": true, "mem": true, "branch": true },
  "mock": false
}
```

Create `dev-servers.widget/lib/mock.json`:

```json
{
  "generatedAt": "2026-07-23T12:00:00.000Z",
  "status": "ok",
  "servers": [
    { "kind": "process", "pid": 111, "port": 3000, "ports": [3000], "command": "node", "name": null, "project": "2nspired", "branch": "main", "ageSeconds": 7200, "age": "2h", "stale": false, "cpu": 1.2, "memMb": 210, "health": "up" },
    { "kind": "process", "pid": 222, "port": 8080, "ports": [8080], "command": "node", "name": null, "project": "acme-api", "branch": "fix/auth", "ageSeconds": 260000, "age": "3d", "stale": true, "cpu": 0.0, "memMb": 96, "health": "up" },
    { "kind": "process", "pid": 223, "port": 9999, "ports": [9999], "command": "python3.12", "name": null, "project": "acme-api", "branch": "fix/auth", "ageSeconds": 300, "age": "5m", "stale": false, "cpu": 0.3, "memMb": 44, "health": "down" },
    { "kind": "docker", "pid": null, "port": 5432, "ports": [5432], "command": "postgres:16", "name": "acme-api-db-1", "project": "acme-api", "branch": null, "ageSeconds": 18000, "age": "5h", "stale": false, "cpu": null, "memMb": null, "health": "tcp" },
    { "kind": "tunnel", "pid": 333, "port": null, "ports": [], "command": "ngrok", "name": null, "project": null, "branch": null, "ageSeconds": 2700, "age": "45m", "stale": false, "cpu": 0.1, "memMb": 30, "health": "unknown" }
  ]
}
```

Create `dev-servers.widget/lib/run.sh` (then `chmod 755`):

```bash
#!/bin/bash
# Übersicht runs commands with a minimal PATH; find node in the usual homes.
DIR="$(cd "$(dirname "$0")" && pwd)"
for NODE in node /opt/homebrew/bin/node /usr/local/bin/node; do
  if command -v "$NODE" >/dev/null 2>&1; then
    exec "$NODE" "$DIR/collect.js" "$@"
  fi
done
echo '{"status":"error","message":"dev-servers-widget needs Node.js — install from https://nodejs.org or brew install node","servers":[]}'
```

- [ ] **Step 4: Write the orchestrator**

Create `dev-servers.widget/lib/collect.js`:

```js
#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const DEFAULTS = {
  position: { corner: "top-right" },
  refreshSeconds: 10,
  staleHours: 24,
  maxRows: 12,
  ignoreProcesses: [],
  ignorePorts: [],
  show: { uptime: true, health: true, cpu: true, mem: true, branch: true },
  mock: false,
};

function readConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8");
    const user = JSON.parse(raw);
    return { ...DEFAULTS, ...user, show: { ...DEFAULTS.show, ...(user.show || {}) } };
  } catch {
    return { ...DEFAULTS, show: { ...DEFAULTS.show } };
  }
}

// Fixed argv only — observed process/container names are never passed as
// arguments; the only dynamic argv values are integer-validated PIDs.
function run(cmd, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      // lsof exits non-zero in benign cases; whatever stdout produced is usable.
      resolve(String(stdout || ""));
    });
  });
}

async function main() {
  const config = readConfig();
  const useMock = process.argv.includes("--no-mock")
    ? false
    : config.mock || process.argv.includes("--mock");

  if (useMock) {
    const mock = JSON.parse(fs.readFileSync(path.join(__dirname, "mock.json"), "utf8"));
    process.stdout.write(JSON.stringify({ ...mock, config }));
    return;
  }

  const { parseLsof, dedupe, filterNoise } = require("./ports");
  const { parseDockerPs, mergeDocker } = require("./docker");
  const enrich = require("./enrich");
  const { probeAll } = require("./health");

  const [lsofOut, dockerOut, allPs] = await Promise.all([
    run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]),
    run("docker", ["ps", "--format", "{{json .}}"]), // docker absent/stopped -> "" -> zero rows
    run("ps", ["-axo", "pid=,comm="]),
  ]);

  let rows = filterNoise(dedupe(parseLsof(lsofOut)), config).map((r) => ({
    kind: "process",
    ...r,
  }));
  rows = mergeDocker(rows, parseDockerPs(dockerOut));

  // Tunnels: reclassify port-scanned rows (ngrok holds its web-UI port),
  // append portless ones (stripe listen holds no local port).
  const byPid = new Map(rows.filter((r) => Number.isInteger(r.pid)).map((r) => [r.pid, r]));
  for (const t of enrich.parseTunnels(allPs)) {
    const existing = byPid.get(t.pid);
    if (existing) existing.kind = "tunnel";
    else rows.push({ ...t, port: null, ports: [] });
  }

  const pids = rows.map((r) => r.pid).filter((p) => Number.isInteger(p));
  const [psOut, cwdOut] = pids.length
    ? await Promise.all([
        run("ps", ["-o", "pid=,etime=,%cpu=,rss=", "-p", pids.join(",")]),
        run("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"]),
      ])
    : ["", ""];
  const stats = enrich.parsePs(psOut);
  const cwds = enrich.parseCwds(cwdOut);

  const ports = [...new Set(rows.map((r) => r.port).filter((p) => Number.isInteger(p)))];
  const health = config.show.health ? await probeAll(ports) : new Map();

  const staleSecs = config.staleHours * 3600;
  const servers = rows.map((r) => {
    const stat = stats.get(r.pid) || {};
    const cwd = Number.isInteger(r.pid) ? cwds.get(r.pid) : null;
    const root = cwd ? enrich.findProjectRoot(cwd) : null;
    return {
      kind: r.kind,
      pid: Number.isInteger(r.pid) ? r.pid : null,
      port: Number.isInteger(r.port) ? r.port : null,
      ports: r.ports || [],
      command: r.command,
      name: r.name || null,
      project: r.project || (root ? path.basename(root) : null),
      branch: config.show.branch && root ? enrich.readBranch(root) : null,
      ageSeconds: stat.ageSeconds ?? null,
      age: enrich.formatAge(stat.ageSeconds ?? null),
      stale: stat.ageSeconds != null && stat.ageSeconds > staleSecs,
      cpu: stat.cpu ?? null,
      memMb: stat.memMb ?? null,
      health: Number.isInteger(r.port) ? health.get(r.port) || "unknown" : "unknown",
    };
  });

  servers.sort(
    (a, b) =>
      String(a.project || a.command).localeCompare(String(b.project || b.command)) ||
      (a.port || 0) - (b.port || 0)
  );

  process.stdout.write(
    JSON.stringify({ generatedAt: new Date().toISOString(), status: "ok", config, servers })
  );
}

// Watchdog: a hung docker/lsof must not pile up collectors across refreshes.
const watchdog = setTimeout(() => {
  process.stdout.write(
    JSON.stringify({ status: "error", message: "collector timed out", servers: [] })
  );
  process.exit(0);
}, 5000);

main()
  .then(() => clearTimeout(watchdog))
  .catch((err) => {
    clearTimeout(watchdog);
    process.stdout.write(
      JSON.stringify({
        status: "error",
        message: String((err && err.message) || err),
        servers: [],
      })
    );
    process.exitCode = 0; // never crash the widget
  });
```

- [ ] **Step 5: Make run.sh executable, run tests**

Run: `chmod 755 dev-servers.widget/lib/run.sh && npm test`
Expected: all tests PASS (the live-run test passes whether or not anything is listening — it only asserts payload shape).

- [ ] **Step 6: Smoke-test by hand against the real machine**

Run: `dev-servers.widget/lib/run.sh | python3 -m json.tool | head -40`
Expected: pretty-printed JSON, `"status": "ok"`, and your actually-running dev servers appear with sensible project names. If a system process leaks through, add it to `DENY_PROCESSES` in `ports.js` with a matching test row in `tests/fixtures/lsof-listen.txt`.

- [ ] **Step 7: Commit**

```bash
git add dev-servers.widget/lib/collect.js dev-servers.widget/lib/run.sh dev-servers.widget/lib/mock.json dev-servers.widget/config.json tests/dev-servers-collect.test.js
git commit -m "feat(dev-servers): collector orchestrator, config, mock, run.sh"
```

---

### Task 6: Renderer (`index.jsx`) and installation

**Files:**
- Create: `dev-servers.widget/index.jsx`

**Interfaces:**
- Consumes: the Task 5 payload (exact shape in Task 5's Produces block) as the `output` string Übersicht passes to `render`.
- Produces: the visible widget. No exports consumed by other tasks.

- [ ] **Step 1: Write index.jsx**

Create `dev-servers.widget/index.jsx`:

```jsx
import { css } from "uebersicht";

export const command = "dev-servers.widget/lib/run.sh";
// Übersicht requires a static export; keep in sync with config.json refreshSeconds.
export const refreshFrequency = 10000;

export const className = `
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
`;

const GREEN = "#5ba97f", AMBER = "#d9a557", GRAY = "#9aa0b0";

const card = css`
  position: absolute;
  min-width: 240px;
  max-width: 420px;
  padding: 10px 14px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92));
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  color: #e8eaf0;
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.7;
`;

const title = css`
  color: #9aa0b0;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 4px;
`;

const row = css`
  display: flex;
  align-items: baseline;
  gap: 7px;
  white-space: nowrap;
`;

const sub = css` color: #9aa0b0; `;
const strong = css` color: #e8eaf0; font-weight: 600; `;

// config.position.corner: "top-right" | "top-left" | "bottom-right" | "bottom-left"
const cornerStyle = (corner) => {
  const [v, h] = String(corner || "top-right").split("-");
  return {
    [v === "bottom" ? "bottom" : "top"]: 12,
    [h === "left" ? "left" : "right"]: 12,
  };
};

const DOT_COLOR = { up: GREEN, tcp: GRAY, down: AMBER, unknown: GRAY };

const Dot = ({ health }) => (
  <span style={{ color: DOT_COLOR[health] || GRAY, fontSize: 8 }}>
    {health === "tcp" ? "◉" : "●"}
  </span>
);

const Row = ({ s, show }) => (
  <div className={row}>
    {show.health && <Dot health={s.health} />}
    <span className={strong}>{s.project || s.name || s.command}</span>
    <span className={sub}>
      {s.port != null ? `:${s.port}` : "→ ☁"}
      {s.ports.length > 1 && ` +${s.ports.length - 1}`}
    </span>
    {(s.project || s.name) && <span className={sub}>{s.command}</span>}
    {show.branch && s.branch && <span className={sub}>⎇ {s.branch}</span>}
    {show.uptime && s.age && (
      <span style={{ color: s.stale ? AMBER : "#9aa0b0" }}>{s.age}</span>
    )}
    {show.cpu && s.cpu != null && <span className={sub}>{Math.round(s.cpu)}%</span>}
    {show.mem && s.memMb != null && <span className={sub}>{s.memMb}MB</span>}
  </div>
);

export const render = ({ output }) => {
  let data;
  try {
    data = JSON.parse(output);
  } catch {
    return null;
  }
  const config = data.config || {};
  const show = config.show || {};
  const style = cornerStyle(config.position && config.position.corner);

  if (data.status === "error") {
    return (
      <div className={card} style={style}>
        <span className={sub}>servers: scan failed</span>
      </div>
    );
  }

  const servers = data.servers || [];
  if (servers.length === 0) return null; // no empty chrome on the desktop

  const max = Number.isInteger(config.maxRows) ? config.maxRows : 12;
  const shown = servers.slice(0, max);
  const hidden = servers.length - shown.length;

  return (
    <div className={card} style={style}>
      <div className={title}>Servers</div>
      {shown.map((s, i) => (
        <Row key={`${s.pid || s.name || i}-${s.port || i}`} s={s} show={show} />
      ))}
      {hidden > 0 && <div className={sub}>+{hidden} more</div>}
    </div>
  );
};
```

- [ ] **Step 2: Install the widget symlink**

Run:

```bash
ln -sfn /Users/thomastrudzinski/Projects/2nspired/ubersicht-mac/dev-servers.widget \
  "$HOME/Library/Application Support/Übersicht/widgets/dev-servers.widget"
```

Expected: `ls -la "$HOME/Library/Application Support/Übersicht/widgets/"` shows the new symlink beside `claude-usage.widget`.

- [ ] **Step 3: Verify rendering with mock data**

Set `"mock": true` in `dev-servers.widget/config.json`, then refresh Übersicht:

```bash
osascript -e 'tell application id "tracesOf.Uebersicht" to refresh'
```

Expected: top-right corner card shows the 5 mock rows — `2nspired :3000`, two `acme-api` rows clustered together, the docker postgres row with a hollow gray dot, the amber `3d` stale age on the 8080 row, and `ngrok → ☁`.

- [ ] **Step 4: Verify live**

Set `"mock": false` back, refresh Übersicht again, and start a throwaway server:

```bash
cd /Users/thomastrudzinski/Projects/2nspired && python3 -m http.server 8123
```

Expected: within ~10s the card shows a `2nspired :8123` row with a green dot and its age counting up; stopping the server removes the row (card disappears entirely if nothing else is running). If noise rows appear, extend `DENY_PROCESSES`/`ignoreProcesses` as in Task 5 Step 6.

- [ ] **Step 5: Run the full suite one last time and commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add dev-servers.widget/index.jsx dev-servers.widget/config.json
git commit -m "feat(dev-servers): corner-card renderer and widget installation"
```

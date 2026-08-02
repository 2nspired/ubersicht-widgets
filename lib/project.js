"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

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

module.exports = { findProjectRoot, parseCwds };

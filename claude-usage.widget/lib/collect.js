#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  layout: "ticker",
  position: { bottom: 8, align: "center" },
  refreshSeconds: 60,
  showCost: true,
  showFable: "auto",
  mock: false,
};

function readConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function layer(loader) {
  try {
    return await loader();
  } catch (err) {
    return { status: "error", message: String(err && err.message ? err.message : err) };
  }
}

async function main() {
  const config = readConfig();
  const useMock = config.mock || process.argv.includes("--mock");
  let providers;

  if (useMock) {
    providers = JSON.parse(fs.readFileSync(path.join(__dirname, "mock.json"), "utf8")).providers;
  } else {
    const logs = await layer(() => {
      const { collectLogs } = require("./logs");
      return collectLogs();
    });
    const limits = await layer(() => {
      const { collectLimits } = require("./limits");
      return collectLimits();
    });
    providers = { claude: { logs, limits } };
  }

  process.stdout.write(
    JSON.stringify({ generatedAt: new Date().toISOString(), config, providers })
  );
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: "collect-failed", message: String(err) }));
  process.exitCode = 0; // never crash the widget
});

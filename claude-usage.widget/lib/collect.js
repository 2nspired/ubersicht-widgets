#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  layout: "ticker",
  position: { bottom: 8, align: "center" },
  refreshSeconds: 60,
  showCost: true,
  showTokens: true,
  showEnergy: false,
  showFable: "auto",
  scale: 1,
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

const { resolveTheme } = require("./theme");

// Hoisted to module level so main().catch — which runs outside main()'s
// scope — can still emit a themed payload. Mirrors dev-servers/collect.js.
const CONFIG = readConfig();
const THEME = resolveTheme({ widgetDir: __dirname, config: CONFIG });

async function layer(loader) {
  try {
    return await loader();
  } catch (err) {
    return { status: "error", message: String(err && err.message ? err.message : err) };
  }
}

async function main() {
  const config = CONFIG;
  const useMock = process.argv.includes("--no-mock") ? false : config.mock || process.argv.includes("--mock");
  let providers;

  if (useMock) {
    providers = JSON.parse(fs.readFileSync(path.join(__dirname, "mock.json"), "utf8")).providers;
  } else {
    const logs = await layer(() => {
      const { collectLogs } = require("./logs");
      return collectLogs({
        home: process.env.CLAUDE_USAGE_WIDGET_HOME || undefined,
        cachePath: process.env.CLAUDE_USAGE_WIDGET_CACHE || undefined,
      });
    });
    const limits = await layer(() => {
      const { collectLimits } = require("./limits");
      return collectLimits();
    });
    providers = { claude: { logs, limits } };
  }

  process.stdout.write(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      config,
      theme: THEME.theme,
      themeError: THEME.themeError,
      providers,
    })
  );
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      error: "collect-failed",
      message: String(err),
      theme: THEME.theme,
      themeError: THEME.themeError,
    })
  );
  process.exitCode = 0; // never crash the widget
});

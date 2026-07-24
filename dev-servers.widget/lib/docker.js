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

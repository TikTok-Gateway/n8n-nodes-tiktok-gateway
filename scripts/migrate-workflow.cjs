#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
function migrate(input, originalId) {
  const workflow = structuredClone(input);
  if (!workflow || !Array.isArray(workflow.nodes))
    throw new Error("Expected one exported workflow object.");
  for (const node of workflow.nodes) {
    if (
      ![
        "CUSTOM.tikTokFollowerTrigger",
        "CUSTOM.tikTokText",
        "CUSTOM.tikTokSticker",
      ].includes(node.type)
    )
      continue;
    if (node.type !== "CUSTOM.tikTokFollowerTrigger") {
      node.parameters ??= {};
      node.parameters.options ??= {};
      if (!node.parameters.options.actionKey) {
        const id = originalId || workflow.id;
        if (!id || !node.id)
          throw new Error(
            "Original workflow ID and node IDs are required to preserve automatic action keys. Pass --workflow-id ORIGINAL_ID.",
          );
        node.parameters.options.actionKey = `${id}:${node.id}`;
      }
    }
    node.type = node.type.replace("CUSTOM.", "n8n-nodes-tiktok-gateway.");
  }
  workflow.active = false;
  return workflow;
}
module.exports = { migrate };
if (require.main === module) {
  try {
    const [source, destination, flag, id] = process.argv.slice(2);
    if (!source || !destination || (flag && (flag !== "--workflow-id" || !id)))
      throw new Error(
        "Usage: node scripts/migrate-workflow.cjs input.json output.json [--workflow-id ORIGINAL_ID]",
      );
    const input = JSON.parse(fs.readFileSync(source, "utf8"));
    const result = Array.isArray(input)
      ? input.map((w) => migrate(w, id))
      : migrate(input, id);
    fs.writeFileSync(destination, JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      "Created inactive migrated workflow. Review before importing; production was not changed.",
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

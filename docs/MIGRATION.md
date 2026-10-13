# Migrate legacy workflows

No production workflow is modified by this package or script. Export the current workflow to a private location first. Exported workflow files may contain personal data; do not commit them here. Keep a backup and resolve any pending/failed executions before switching when possible.

Run locally:

```sh
node scripts/migrate-workflow.cjs /private/current.json /private/migrated.json
# If the export has no workflow ID, supply its ORIGINAL n8n workflow ID:
node scripts/migrate-workflow.cjs /private/current.json /private/migrated.json --workflow-id ORIGINAL_ID
```

The output path must not already exist. The tool accepts one workflow or an exported array. For arrays, prefer their own IDs; do not supply one override for unrelated workflows.

Mappings:

| Old type | New type |
| --- | --- |
| `CUSTOM.tikTokFollowerTrigger` | `n8n-nodes-tiktok-gateway.tikTokFollowerTrigger` |
| `CUSTOM.tikTokText` | `n8n-nodes-tiktok-gateway.tikTokText` |
| `CUSTOM.tikTokSticker` | `n8n-nodes-tiktok-gateway.tikTokSticker` |

It preserves node IDs, names, credentials references, connections, webhook IDs, message text, parameters, and explicit action keys. For send nodes with an empty/missing action key it pins `ORIGINAL_WORKFLOW_ID:NODE_ID`. This preserves the old key even if n8n assigns a different workflow ID at import. Existing expressions are preserved verbatim; inspect any expression that depends on workflow identity, execution identity, time, or environment manually. The output is inactive. Runtime/pinned data is preserved by the script for fidelity; keep exports private.

1. Install the package in a maintenance window and verify all three node types and existing credentials are available.
2. Diff the two JSON files: only the three type mappings, missing action-key defaults, and `active: false` should change.
3. Review the inactive migrated workflow in n8n. Confirm credential references still point to your existing credential, and verify all expressions and action keys. Never translate or replace message content during migration.
4. Arrange a deliberate cutover: unpublish the old trigger before publishing the migrated one. Both use the same fixed webhook path and must not be active together. The gateway's single production webhook URL can stay unchanged if n8n's public URL stays the same.
5. Retain the legacy nodes for old saved/waiting execution snapshots; retrying those may still require `CUSTOM.*`. Do not clear their keys or recreate old nodes with new IDs. A migrated workflow import does not rewrite execution history.
6. Confirm future genuine events in the execution view. Do not test migration by sending real messages. To roll back, unpublish the new workflow and restore/publish the original, preserving every action key.

There is no automatic gateway pause/resume, live restart, or workflow activation in this migration tool. A stopped workflow does not cancel accepted messages. Events may accumulate while the production webhook is unavailable and arrive later; deduplication relies on unchanged keys and retained gateway records.

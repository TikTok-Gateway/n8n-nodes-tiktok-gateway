# n8n-nodes-tiktok-gateway

Private, installable community nodes for a self-hosted TikTok Gateway. All network requests go through your gateway. No TikTok cookies or direct TikTok requests are used.

- **TikTok: New Follower** authenticates follower webhooks with a separate token.
- **TikTok: Send Text** sends the text exactly as entered.
- **TikTok: Send Sticker** loads numeric sticker IDs from the gateway catalog.

`New Follower → Wait → Send Text → Send Sticker`

Both send nodes return only after the gateway reports `succeeded`. Failed, uncertain, unknown, malformed, and timed-out operations stop the node. Keep n8n's default **Stop Workflow** error behavior; enabling Continue On Fail changes the workflow's behavior. Retry On Fail preserves the same key.

## Compatibility and installation

Tested with **n8n 2.43.4**, its `n8n-workflow 2.43.2`, and Node.js 22+. Other n8n releases are not certified. This is a private self-hosted package, not an n8n Cloud verified node. The development lockfile overrides Axios to a patched release; the installed package uses the host n8n HTTP runtime, whose updates remain the host administrator’s responsibility. No production dependencies are bundled; n8n provides `n8n-workflow`.

Build an archive:

```sh
npm ci
npm test
npm pack
npm run smoke
```

Install the archive into the persistent n8n user directory without rebuilding your image. Replace `YOUR_N8N_CONTAINER` with the existing container name. These commands are for your planned maintenance window; installation requires restarting n8n to discover the package.

```sh
N8N_CONTAINER=YOUR_N8N_CONTAINER
docker cp n8n-nodes-tiktok-gateway-0.1.0.tgz "$N8N_CONTAINER":/tmp/tiktok-gateway.tgz
docker exec -u node "$N8N_CONTAINER" sh -c 'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install --offline --ignore-scripts --legacy-peer-deps --no-audit --no-fund /tmp/tiktok-gateway.tgz'
docker restart "$N8N_CONTAINER"
```

`--legacy-peer-deps` intentionally uses the host n8n dependency instead of downloading a second workflow runtime. The smoke test verifies this exact offline installation on a stock n8n image. Keep `/home/node/.n8n` on a persistent volume. In queue mode install the same package on every main, webhook, and worker instance. Community packages must be enabled.

If your existing image still loads the old `CUSTOM.*` nodes, keep them available while reviewing migration and any old waiting executions. Both packages retain credential type `tikTokGatewayApi`; do not delete existing credentials. Remove legacy extensions only after old executions no longer need them, and verify credentials after the next restart. See [migration](docs/MIGRATION.md).

## Credentials and configuration

Create one **TikTok Gateway** credential and select it in all three nodes:

| Field | Value |
| --- | --- |
| Gateway URL | Your gateway base URL, e.g. `http://tiktok-gateway:8080` on a shared Docker network |
| API Token | Gateway API bearer token |
| Webhook Token | Separate token matching the gateway's webhook bearer token |

Use HTTPS across untrusted networks. `localhost` inside n8n refers to n8n's container. Never enter cookies or tokens in node parameters, workflow JSON, or message text.

Import [the inactive example](examples/welcome.json), select credentials, review the welcome text, and select a sticker from your gateway. The sample retains the original Russian message deliberately: user-authored message text is never translated. All package UI and documentation are English.

Publish only one trigger workflow for a gateway. Configure its production URL in the gateway: `https://YOUR_N8N/webhook/tiktok-follower-gateway`. The path is intentionally compatible with the original custom nodes. The current gateway has one webhook URL; branch within this workflow for multiple actions. The trigger never registers URLs or changes gateway configuration automatically. Test URLs require the editor to be listening; do not replace the production URL for casual testing.

Supported `follower.created` events require schema version `1`, a nonempty printable ASCII event ID, numeric string account/user IDs, and valid timestamps. Unsupported event types/versions receive 204; unauthorized events receive 401 and malformed supported events 400. A 200 acknowledges acceptance, not completion of downstream messages. Tokens and HTTP headers are not emitted. Known event fields are preserved; arbitrary extra webhook fields are intentionally excluded. Send nodes preserve incoming JSON, binary data, and pair each output item with its input.

## Delivery, retries, and restarts

The exact key is `eventId:actionKey`. Without an explicit action key, it is `eventId:workflowId:nodeId`, matching the old implementation. It never includes execution ID, time, randomness, or retry count. Keep IDs and action keys unchanged for redelivery, Retry, migration, and recovery. Use a new key only for an intentionally new action, never to bypass failed or uncertain operations. A changed command with the same key should return HTTP 409.

Send nodes poll every second, by default for 300 seconds (5–3600 configurable). The deadline is checked between requests; a request can add up to 15 seconds. **Timeout, n8n shutdown, or stopping an execution does not cancel an accepted gateway command.** Check gateway state and retry the original input with the same key. Nodes never resume a paused gateway, reconcile an operation, or generate a replacement key.

Errors include the operation ID, reason code, and available numeric TikTok `status`/`check`. Network errors are sanitized and do not expose raw response bodies, request headers, or cookies. If the POST response is lost, the operation ID is not yet known: repeat with the same key to retrieve the original operation. If polling fails, the known operation ID is retained in the error.

Polling is in-process, not a durable n8n Wait. A crash during polling may leave a crashed/interrupted execution requiring manual retry or replay of its original event. Already accepted gateway operations continue independently. A standard n8n Wait of at least 65 seconds was tested across restart with persistent storage; it resumed automatically. Short Waits can remain in memory. Old waiting executions may retain snapshots of `CUSTOM.*` nodes, so retain legacy code until they are resolved. Do not assume editing the workflow migrates those snapshots.

Webhook acceptance and downstream completion are separate: a later failure does not cause gateway webhook redelivery automatically. A crash around acknowledgement also has an acceptance/persistence window; this package is not an exactly-once event queue. Keep gateway storage intact: idempotency guarantees depend on its retained operation records. Restoring an old/empty gateway database can invalidate deduplication.

## Development and releases

Source is strict TypeScript in `nodes/` and `credentials/`; compiled files and SVG assets go to `dist/`. The API snapshot is in [docs/openapi.json](docs/openapi.json). Adapted from the local `tiktok-gateway/n8n` implementation (the earlier `tiktok-chat-bot` directory was unavailable).

`npm test` covers keys, terminal errors, polling, timeouts, sanitization, payload handling, item links, catalog, and migration. `npm run smoke` uses unique disposable Docker containers, a stock pinned n8n image, temporary synthetic credentials and a mock API. It verifies package discovery, duplicate delivery, failed/uncertain blocking, crash/replay, saved Wait restart, and execution diagnostics. It never connects to a real gateway or TikTok, and removes only its own containers/network. Docker must be running; pull the pinned image first if it is not cached. GitHub Actions builds, tests, packs, and runs the same smoke test.

For a release: update the version and lockfile (`npm version patch --no-git-tag-version`), update [CHANGELOG.md](CHANGELOG.md), run the checks, then commit and tag `vX.Y.Z`. CI uploads the `.tgz` as a build artifact. Distribute it privately. `private: true` prevents accidental npm publication; no publishing workflow exists. Install a newer archive using the same commands, then restart during maintenance. To roll back, install the retained previous archive and restart; preserve workflow IDs, credentials, and keys in either direction.

References: [n8n node parameters](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/standard-parameters/) and [manual package installation](https://docs.n8n.io/integrations/community-nodes/installation-and-management/manual-installation/).

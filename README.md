<img src="https://raw.githubusercontent.com/TikTok-Gateway/n8n-nodes-tiktok-gateway/v0.1.5/nodes/tiktok.png" alt="TikTok Gateway logo" width="128" height="128">

# n8n-nodes-tiktok-gateway

Installable community nodes for a self-hosted TikTok Gateway. All network requests go through your gateway. No TikTok cookies or direct TikTok requests are used.

- **TikTok: New Follower** authenticates follower webhooks with a separate token.
- **TikTok: Send Text** sends the text exactly as entered.
- **TikTok: Send Sticker** loads named, numeric sticker IDs from the persistent gateway catalogue. Import a sticker once with `POST /v1/stickers/import` (gateway 0.3.0+); the source chat is not needed afterwards.
- **TikTok: Events** receives followers and incoming direct messages on separate outputs.
- **TikTok: Get Messages** reads paginated history and reports completeness/gaps. Scenario filters belong in workflows.

For context-only replies without dialog stages, see [Incoming messages](docs/INCOMING.md)
and the inactive [strict example](examples/welcome-reply.json).

`New Follower → Wait → Send Text → Send Sticker`

Both send nodes return only after the gateway reports `succeeded`. Failed, uncertain, unknown, malformed, and timed-out operations stop the node. Keep n8n's default **Stop Workflow** error behavior; enabling Continue On Fail changes the workflow's behavior. Retry On Fail preserves the same key.

## Compatibility and installation

Install by name in self-hosted n8n: **Settings → Community Nodes → Install**, enter `n8n-nodes-tiktok-gateway`, acknowledge the community package prompt, and select **Install**. Configure one TikTok Gateway credential for all TikTok nodes. Unverified community packages must be enabled; this does not imply n8n Cloud verification.

Tested with **n8n 2.43.4**, its `n8n-workflow 2.43.2`, and Node.js 22+. Other n8n releases are not certified. The source repository is public. The package is for self-hosted n8n and is not an n8n Cloud verified node. The release pipeline publishes to npm after tests pass. Maintainer setup is documented in [Publishing](docs/PUBLISHING.md). The development lockfile overrides Axios to a patched release; the installed package uses the host n8n HTTP runtime, whose updates remain the host administrator’s responsibility. No production dependencies are bundled; n8n provides `n8n-workflow`.

Download the ready-to-install `.tgz` from [GitHub Releases](https://github.com/TikTok-Gateway/n8n-nodes-tiktok-gateway/releases/latest). You do not need Node.js or a local build to use a release archive.

For development, build an archive:

```sh
npm ci
npm test
npm pack
npm run smoke
```

Install the archive into the persistent n8n user directory without rebuilding your image. Replace `YOUR_N8N_CONTAINER` with the existing container name. These commands are for your planned maintenance window; installation requires restarting n8n to discover the package.

```sh
N8N_CONTAINER=YOUR_N8N_CONTAINER
# Set this to the archive downloaded from Releases.
PACKAGE_ARCHIVE=./n8n-nodes-tiktok-gateway-0.1.1.tgz
docker cp "$PACKAGE_ARCHIVE" "$N8N_CONTAINER":/tmp/tiktok-gateway.tgz
docker exec -u node "$N8N_CONTAINER" sh -c 'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install --offline --ignore-scripts --legacy-peer-deps --no-audit --no-fund /tmp/tiktok-gateway.tgz'
docker restart "$N8N_CONTAINER"
```

`--legacy-peer-deps` intentionally uses the host n8n dependency instead of downloading a second workflow runtime. The smoke test verifies this exact offline installation on a stock n8n image. Keep `/home/node/.n8n` on a persistent volume. In queue mode install the same package on every main, webhook, and worker instance. Community packages must be enabled.

If your existing image still loads the old `CUSTOM.*` nodes, keep them available while reviewing migration and any old waiting executions. Both packages retain credential type `tikTokGatewayApi`; do not delete existing credentials. Remove legacy extensions only after old executions no longer need them, and verify credentials after the next restart. See [migration](docs/MIGRATION.md).

## Credentials and configuration

Create one **TikTok Gateway** credential and select it in all TikTok nodes:

| Field | Value |
| --- | --- |
| Gateway URL | Your gateway base URL, e.g. `http://tiktok-gateway:8080` on a shared Docker network |
| API Token | Gateway API bearer token |
| Webhook Token | Separate token matching the gateway's webhook bearer token |

Use HTTPS across untrusted networks. `localhost` inside n8n refers to n8n's container. Never enter cookies or tokens in node parameters, workflow JSON, or message text.

Import [the inactive example](examples/welcome.json), select credentials, create a **TikTok Settings** Data Table with string **name** and **message** columns and a row **name=welcomeText** containing your welcome in **message**, and select a sticker from your gateway. The reply workflow also reads `ask_subscription`, `explain_channel`, and `bot_question` from this table. All four texts are edited in one place; see [shared configuration](docs/INCOMING.md). All package UI and documentation are English.

Publish only one trigger workflow for a gateway. Configure its production URL in the gateway: `https://YOUR_N8N/webhook/tiktok-follower-gateway`. The path is intentionally compatible with the original custom nodes. The current gateway has one webhook URL; branch within this workflow for multiple actions. The trigger never registers URLs or changes gateway configuration automatically. Test URLs require the editor to be listening; do not replace the production URL for casual testing.

Supported `follower.created` events require schema version `1`, a nonempty printable ASCII event ID, numeric string account/user IDs, and valid timestamps. Unsupported event types/versions receive 204; unauthorized events receive 401 and malformed supported events 400. A 200 acknowledges acceptance, not completion of downstream messages. Tokens and HTTP headers are not emitted. Known event fields are preserved; arbitrary extra webhook fields are intentionally excluded. Send nodes preserve incoming JSON, binary data, and pair each output item with its input.

## Delivery, retries, and restarts

The exact key is `eventId:actionKey`. Without an explicit action key, it is `eventId:workflowId:nodeId`, matching the old implementation. It never includes execution ID, time, randomness, or retry count. Keep IDs and action keys unchanged for redelivery, Retry, migration, and recovery. Use a new key only for an intentionally new action, never to bypass failed or uncertain operations. A changed command with the same key should return HTTP 409.

Send nodes poll every second, by default for 300 seconds (5–3600 configurable). The deadline is checked between requests; a request can add up to 15 seconds. **Timeout, n8n shutdown, or stopping an execution does not cancel an accepted gateway command.** Check gateway state and retry the original input with the same key. Nodes never resume a paused gateway, reconcile an operation, or generate a replacement key.

Errors include the operation ID, reason code, and available numeric TikTok `status`/`check`. Network errors are sanitized and do not expose raw response bodies, request headers, or cookies. If the POST response is lost, the operation ID is not yet known: repeat with the same key to retrieve the original operation. If polling fails, the known operation ID is retained in the error.

Polling is in-process, not a durable n8n Wait. A crash during polling may leave a crashed/interrupted execution requiring manual retry or replay of its original event. Already accepted gateway operations continue independently. A standard n8n Wait of at least 65 seconds was tested across restart with persistent storage; it resumed automatically. Short Waits can remain in memory. Old waiting executions may retain snapshots of `CUSTOM.*` nodes, so retain legacy code until they are resolved. Do not assume editing the workflow migrates those snapshots.

Webhook acceptance and downstream completion are separate: a later failure does not cause gateway webhook redelivery automatically. A crash around acknowledgement also has an acceptance/persistence window; this package is not an exactly-once event queue. Keep gateway storage intact: idempotency guarantees depend on its retained operation records. Restoring an old/empty gateway database can invalidate deduplication.

## Development and releases

To install from the public source, clone this repository, run `npm ci` and `npm pack`, then copy the resulting archive into your n8n container using the commands above. Alternatively, use the Community Nodes installer.

Source is strict TypeScript in `nodes/` and `credentials/`; compiled files and SVG assets go to `dist/`. The API snapshot is in [docs/openapi.json](docs/openapi.json). Adapted from the local `tiktok-gateway/n8n` implementation (the earlier `tiktok-chat-bot` directory was unavailable).

`npm test` covers keys, terminal errors, polling, timeouts, sanitization, payload handling, item links, catalog, and migration. `npm run smoke` uses unique disposable Docker containers, a stock pinned n8n image, temporary synthetic credentials and a mock API. It verifies package discovery, duplicate delivery, failed/uncertain blocking, crash/replay, saved Wait restart, and execution diagnostics. It never connects to a real gateway or TikTok, and removes only its own containers/network. Docker must be running; pull the pinned image first if it is not cached. GitHub Actions builds, tests, packs, and runs the same smoke test.

Every push to `main`, pull request, or manual Actions run builds and tests the package and uploads its `.tgz` under **Actions → Build and test → Artifacts → npm-package**.

For a release: update the version and lockfile (`npm version patch --no-git-tag-version`), update [CHANGELOG.md](CHANGELOG.md), run the checks, then commit and tag `vX.Y.Z`. Push the tag (`git push origin vX.Y.Z`). After unit and isolated n8n smoke tests pass, the pipeline publishes the tested archive to npm using Trusted Publishing, then creates a GitHub Release containing the exact tested `.tgz` and `SHA256SUMS`. The tag must match `package.json`. Release assets are not overwritten on reruns; use a new version for changes. Publication requires the one-time [npm Trusted Publishing setup](docs/PUBLISHING.md); no long-lived npm token is stored in GitHub. Each npm version is immutable, so use a new version for each release. Install a newer archive using the same commands, then restart during maintenance. To roll back, install the retained previous archive and restart; preserve workflow IDs, credentials, and keys in either direction.

References: [n8n node parameters](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/standard-parameters/) and [manual package installation](https://docs.n8n.io/integrations/community-nodes/installation-and-management/manual-installation/).

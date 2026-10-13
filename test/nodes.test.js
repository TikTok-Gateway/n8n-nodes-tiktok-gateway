"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { TikTokText } = require("../dist/nodes/TikTokText.node");
const {
  TikTokFollowerTrigger,
} = require("../dist/nodes/TikTokFollowerTrigger.node");
function context(operation, calls) {
  return {
    getInputData: () => [{ json: { eventId: "event-1", userId: "200" } }],
    getNodeParameter: (name) =>
      ({
        recipient: "200",
        text: "hello",
        options: { actionKey: "welcome-v1:text-1" },
      })[name],
    getNode: () => ({ id: "text", name: "Text" }),
    getWorkflow: () => ({ id: "workflow" }),
    getCredentials: async () => ({
      url: "http://gateway:8080",
      apiToken: "secret",
    }),
    helpers: {
      httpRequest: async (r) => {
        calls.push(r);
        return operation;
      },
    },
  };
}
test("stable action key across repeated executions; carries trigger data and item linking", async () => {
  const calls = [];
  const ctx = context(
    { operationId: "op", state: "succeeded", messageId: "msg" },
    calls,
  );
  const node = new TikTokText();
  const a = await node.execute.call(ctx);
  await node.execute.call(ctx);
  assert.equal(
    calls[0].headers["Idempotency-Key"],
    "event-1:welcome-v1:text-1",
  );
  assert.equal(
    calls[0].headers["Idempotency-Key"],
    calls[1].headers["Idempotency-Key"],
  );
  assert.equal(a[0][0].json.eventId, "event-1");
  assert.equal(a[0][0].pairedItem.item, 0);
});
test("refusal includes codes and does not retry POST", async () => {
  const calls = [];
  const ctx = context(
    {
      operationId: "op",
      state: "failed",
      reason: "tiktok_rejected_send",
      tiktokRejection: { status: 3, check: 7170 },
    },
    calls,
  );
  await assert.rejects(
    () => new TikTokText().execute.call(ctx),
    /status=3, check=7170/,
  );
  assert.equal(calls.length, 1);
});
test("uncertain blocks downstream, missing event does not send, network errors hide secrets", async () => {
  const calls = [];
  const ctx = context(
    { operationId: "op", state: "uncertain", reason: "send_result_unknown" },
    calls,
  );
  await assert.rejects(() => new TikTokText().execute.call(ctx), /uncertain/);
  ctx.getInputData = () => [{ json: { userId: "200" } }];
  await assert.rejects(() => new TikTokText().execute.call(ctx), /event ID/);
  assert.equal(calls.length, 1);
  ctx.getInputData = () => [{ json: { userId: "200", eventId: "e" } }];
  ctx.helpers.httpRequest = async () => {
    throw new Error("secret cookie");
  };
  await assert.rejects(
    () => new TikTokText().execute.call(ctx),
    (e) => !e.message.includes("secret") && e.message.includes("no response"),
  );
});
test("trigger authenticates, rejects malformed IDs, excludes headers from output", async () => {
  let status = 0;
  const req = {
    headers: { authorization: "Bearer hook" },
    body: {
      schemaVersion: "1",
      type: "follower.created",
      eventId: "event",
      accountId: "100",
      occurredAt: "2026-01-01T00:00:00Z",
      detectedAt: "2026-01-01T00:00:01Z",
      data: { userId: "200" },
    },
  };
  const ctx = {
    getRequestObject: () => req,
    getResponseObject: () => ({
      status(n) {
        status = n;
        return this;
      },
      json() {},
      end() {},
    }),
    getCredentials: async () => ({ webhookToken: "hook" }),
  };
  const node = new TikTokFollowerTrigger();
  const result = await node.webhook.call(ctx);
  assert.equal(result.workflowData[0][0].json.userId, "200");
  assert.equal(JSON.stringify(result).includes("Bearer"), false);
  req.headers.authorization = "Bearer wrong";
  assert.equal((await node.webhook.call(ctx)).noWebhookResponse, true);
  assert.equal(status, 401);
  req.headers.authorization = "Bearer hook";
  req.body.data.userId = 200;
  await node.webhook.call(ctx);
  assert.equal(status, 400);
});
test("polls until succeeded, preserves Unicode text, binary and multiple item links", async () => {
  const calls = [];
  const ctx = context(null, calls);
  let poll = 0;
  ctx.getInputData = () =>
    [0, 1].map((i) => ({
      json: { eventId: "e" + i, userId: "200", extra: "kept" },
      binary: { file: { data: "YQ==", mimeType: "text/plain" } },
    }));
  ctx.getNodeParameter = (name) =>
    ({ recipient: "200", text: "Привет 👋", options: {} })[name];
  ctx.helpers.httpRequest = async (r) => {
    calls.push(r);
    return {
      operationId: "op",
      state:
        r.method === "POST" ? "queued" : ++poll ? "succeeded" : "verifying",
    };
  };
  const result = await new TikTokText().execute.call(ctx);
  assert.equal(calls[0].body.text, "Привет 👋");
  assert.equal(calls[0].headers["Idempotency-Key"], "e0:workflow:text");
  assert.equal(result[0][1].pairedItem.item, 1);
  assert.equal(result[0][1].json.extra, "kept");
  assert.equal(result[0][1].binary.file.data, "YQ==");
});
test("timeout never cancels or resumes; retry keeps key", async () => {
  const calls = [];
  const ctx = context({ operationId: "op", state: "queued" }, calls);
  ctx.getNodeParameter = (name) =>
    ({ recipient: "200", text: "hello", options: { timeout: 5 } })[name];
  await assert.rejects(
    () => new TikTokText().execute.call(ctx),
    /has not been canceled/,
  );
  assert.equal(calls.filter((r) => r.method === "POST").length, 1);
  assert(calls.every((r) => !r.url.includes("/control/")));
});
test("rejects malformed operations and sanitizes raw HTTP errors", async () => {
  for (const op of [null, {}, { operationId: "op", state: "mystery" }]) {
    await assert.rejects(
      () => new TikTokText().execute.call(context(op, [])),
      /Invalid gateway/,
    );
  }
  const ctx = context(null, []);
  ctx.helpers.httpRequest = async () => {
    throw { statusCode: "secret cookie", response: { data: "Bearer secret" } };
  };
  await assert.rejects(
    () => new TikTokText().execute.call(ctx),
    (e) => !JSON.stringify(e).includes("secret"),
  );
});
test("sticker catalog and send use only gateway", async () => {
  const { TikTokSticker } = require("../dist/nodes/TikTokSticker.node");
  const calls = [];
  const ctx = context({ operationId: "op", state: "succeeded" }, calls);
  ctx.getNodeParameter = (name) =>
    ({ recipient: "200", stickerId: "9007199254740993", options: {} })[name];
  await new TikTokSticker().execute.call(ctx);
  assert.equal(calls[0].body.stickerId, "9007199254740993");
  ctx.helpers.httpRequest = async () => ({
    stickers: [{ id: "9007199254740993" }],
  });
  assert.deepEqual(
    await new TikTokSticker().methods.loadOptions.getStickers.call(ctx),
    [{ name: "Sticker 9007199254740993", value: "9007199254740993" }],
  );
});
test("migration preserves IDs, credentials, connections, message and explicit keys", () => {
  const { migrate } = require("../scripts/migrate-workflow.cjs");
  const w = {
    id: "old",
    active: true,
    nodes: [
      {
        id: "n",
        type: "CUSTOM.tikTokText",
        credentials: { tikTokGatewayApi: { id: "c" } },
        parameters: { text: "Привет", options: {} },
      },
    ],
    connections: { a: { main: [] } },
  };
  const m = migrate(w);
  assert.equal(m.nodes[0].parameters.options.actionKey, "old:n");
  assert.equal(m.active, false);
  assert.deepEqual(m.connections, w.connections);
  assert.deepEqual(m.nodes[0].credentials, w.nodes[0].credentials);
  assert.equal(m.nodes[0].parameters.text, "Привет");
  assert.equal(w.active, true);
  assert.deepEqual(migrate(m), m);
  assert.throws(() => migrate({ ...w, id: undefined }), /Original workflow ID/);
  w.nodes[0].parameters.options.actionKey = "welcome-v1:text-1";
  assert.equal(
    migrate(w).nodes[0].parameters.options.actionKey,
    "welcome-v1:text-1",
  );
});

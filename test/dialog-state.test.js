"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const workflow = require("../examples/welcome-reply.json");
const { TikTokText } = require("../dist/nodes/TikTokText.node");
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const event = { accountId: "100", userId: "200", eventId: "event-1" };
const expr = (value, json) =>
  typeof value === "string" && value.startsWith("={{")
    ? new Function("$json", "$now", `return (${value.slice(3, -2)});`)(json, {
        toISO: () => "2026-10-14T12:00:00.000Z",
      })
    : value;
const next = (name, output = 0) =>
  workflow.connections[name]?.main?.[output]?.map((edge) => edge.node) || [];
// Follow the real exported graph; mock only Data Table storage.
function runGuards(start, rows, json = event) {
  let name = start;
  while (nodes.get(name)?.parameters.operation === "rowNotExists") {
    const node = nodes.get(name);
    assert.equal(node.alwaysOutputData, undefined);
    assert.equal(node.onError, undefined);
    assert.equal(node.parameters.matchType, "allConditions");
    const matches = rows.some((row) =>
      node.parameters.filters.conditions.every((condition) => {
        assert.equal(condition.condition, "eq");
        return row[condition.keyName] === expr(condition.keyValue, json);
      }),
    );
    if (matches) return null;
    [name] = next(name);
  }
  return name;
}
const row = (status, account_id = "100", user_id = "200") => ({
  account_id,
  user_id,
  status,
});
test("closed and paused users stop before wait, configuration, history and AI", () => {
  const [start] = next("Events", 1);
  for (const status of ["closed", "paused"]) {
    assert.equal(runGuards(start, [row(status)]), null);
    assert.equal(runGuards(start, [row("open"), row(status)]), null);
  }
  for (const rows of [
    [],
    [row("open")],
    [row("closed", "101")],
    [row("paused", "100", "201")],
  ]) {
    assert.equal(runGuards(start, rows), "Wait for Reply Burst");
  }
});
test("an execution already waiting or ready to send rechecks the current status", () => {
  for (const [source, destination] of [
    ["Wait for Reply Burst", "Shared Messages"],
    ["History Unchanged", "Your Reply"],
  ]) {
    const [start] = next(source);
    assert.equal(runGuards(start, []), destination);
    assert.equal(runGuards(start, [row("closed")]), null);
    assert.equal(runGuards(start, [row("paused")]), null);
  }
});
async function send(state, action, reason = "tiktok_rejected_send") {
  return new TikTokText().execute.call({
    getInputData: () => [{ json: { ...event, action } }],
    getNodeParameter: (name) =>
      ({
        recipient: "200",
        text: "Closing reply",
        options: { actionKey: "closing" },
      })[name],
    getNode: () => ({ id: "send", name: "Send" }),
    getWorkflow: () => ({ id: "test" }),
    getCredentials: async () => ({
      url: "http://mock.invalid",
      apiToken: "synthetic",
    }),
    helpers: {
      httpRequest: async () => ({
        operationId: "op",
        state,
        reason,
      }),
    },
  });
}
test("only a confirmed closing send reaches the closed upsert", async () => {
  const [check] = next("Your Reply");
  const condition =
    nodes.get(check).parameters.conditions.conditions[0].leftValue;
  for (const action of [
    "subscription_confirmed",
    "ask_subscription",
    "explain_channel",
    "bot_question",
  ]) {
    const [sent] = await send("succeeded", action);
    assert.equal(
      expr(condition, sent[0].json),
      action === "subscription_confirmed",
    );
  }
  const [sent, skipped] = await send(
    "failed",
    "subscription_confirmed",
    "recipient_unavailable",
  );
  assert.equal(sent.length, 0);
  assert.equal(skipped.length, 1);
  assert.deepEqual(next("Your Reply", 1), []);
  await assert.rejects(() => send("failed", "subscription_confirmed"));
  assert.deepEqual(next(check), ["Close Dialog"]);
});
test("closure is keyed by account and user and preserves confirmed identity", async () => {
  const [[{ json }]] = await send("succeeded", "subscription_confirmed");
  const node = nodes.get("Close Dialog");
  assert.equal(node.parameters.operation, "upsert");
  assert.equal(node.parameters.matchType, "allConditions");
  assert.deepEqual(
    node.parameters.filters.conditions.map((c) => [
      c.keyName,
      expr(c.keyValue, json),
    ]),
    [
      ["account_id", "100"],
      ["user_id", "200"],
    ],
  );
  const stored = Object.fromEntries(
    Object.entries(node.parameters.columns.value).map(([k, v]) => [
      k,
      expr(v, json),
    ]),
  );
  assert.deepEqual(stored, {
    ...row("closed"),
    closed_at: "2026-10-14T12:00:00.000Z",
  });
  assert.equal(runGuards(next("Events", 1)[0], [stored]), null);
  assert.equal(node.retryOnFail, true);
  assert.equal(node.continueOnFail, undefined);
});

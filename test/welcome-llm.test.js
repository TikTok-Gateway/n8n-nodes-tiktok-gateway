const test = require("node:test");
const assert = require("node:assert/strict");
const workflow = require("../examples/welcome-reply.json");
const node = (name) => workflow.nodes.find((n) => n.name === name);
const expression = (text) =>
  new Function("$json", "$", "return (" + text.slice(3, -2).trim() + ");");
const validate = expression(
  node("Clear Relevant Intent").parameters.conditions.conditions[0].leftValue,
);
const select = expression(node("Select Your Reply").parameters.jsonOutput);
const unchanged = expression(
  node("History Unchanged").parameters.conditions.conditions[0].leftValue,
);
const decision = (intent = "ask_subscription", extra = {}) => ({
  intent,
  unambiguous: true,
  onlyRelevant: true,
  ...extra,
});
const response = (value) => ({ json: { output: value } });
const source = (id) => ({
  json: {
    userId: id,
    message: { text: "да" },
    settings: {
      replies: {
        ask_subscription: "configured yes",
        explain_channel: "configured no",
        bot_question: "configured bot",
        subscription_confirmed: "Легааа)",
      },
    },
    classificationContext: "{}",
  },
});
function run(items, sources = items.map((_, i) => source(String(i)))) {
  return items.flatMap((item, i) => {
    const lookup = (name) => {
      assert.equal(name, "Welcome Reply Gate");
      return { item: sources[i] };
    };
    return validate(item.json, lookup)
      ? [{ json: select(item.json, lookup), pairedItem: { item: i } }]
      : [];
  });
}
test("LLM routes only allowed intent to user-authored text, preserving item linking", () => {
  const out = run(
    ["ask_subscription", "explain_channel", "bot_question"].map((i) =>
      response(decision(i)),
    ),
  );
  assert.deepEqual(
    out.map((i) => i.json.replyText),
    ["configured yes", "configured no", "configured bot"],
  );
  assert.deepEqual(
    out.map((i) => i.json.userId),
    ["0", "1", "2"],
  );
  assert.deepEqual(
    out.map((i) => i.pairedItem),
    [{ item: 0 }, { item: 1 }, { item: 2 }],
  );
});
test("ignore, uncertainty, mixed intent, wrong types and injected fields produce no reply", () => {
  for (const value of [
    decision("ignore"),
    decision("other"),
    decision("ask_subscription", { unambiguous: false }),
    decision("ask_subscription", { onlyRelevant: false }),
    decision("ask_subscription", { unambiguous: "true" }),
    decision("ask_subscription", { replyText: "injected" }),
    decision("ask_subscription", { userId: "attacker" }),
    null,
    [],
    {},
    "ask_subscription",
  ]) {
    assert.deepEqual(run([response(value)]), []);
  }
});
test("raw text, wrapper, provider errors and unexpected fields cannot bypass the parser contract", () => {
  for (const value of [
    { text: JSON.stringify(decision()) },
    { output: decision() },
    { error: "failed" },
    { ...decision(), refusal: "no" },
    { ...decision(), tool_calls: [] },
    { ...decision(), finish_reason: "length" },
  ]) {
    assert.deepEqual(run([response(value)]), []);
  }
});
test("empty reply drops only its own item without changing recipient mapping", () => {
  const sources = [source("alice"), source("bob")];
  sources[0].json.settings.replies.ask_subscription = "";
  const out = run([response(decision()), response(decision())], sources);
  assert.equal(out.length, 1);
  assert.equal(out[0].json.userId, "bob");
  assert.deepEqual(out[0].pairedItem, { item: 1 });
});
test("workflow keeps one Code node, native AI, result gate and history recheck", () => {
  assert.equal(workflow.active, false);
  assert.equal(
    workflow.nodes.filter((n) => n.type === "n8n-nodes-base.code").length,
    1,
  );
  assert.equal(node("Message Configuration").type, "n8n-nodes-base.set");
  for (const name of ["Get Messages", "Recheck Before Sending"])
    assert.deepEqual(Object.keys(node(name).parameters).sort(), [
      "maxPages",
      "recipient",
    ]);
  assert.equal(
    workflow.connections["Get Messages"].main[0][0].node,
    "Welcome Reply Gate",
  );
  assert.equal(
    workflow.connections["Recheck Before Sending"].main[0][0].node,
    "History Unchanged",
  );
  assert.equal(
    workflow.connections["History Unchanged"].main[0][0].node,
    "Not Closed Before Send",
  );
  assert.equal(
    expression(node("Your Reply").parameters.options.actionKey)({
      action: "ask_subscription",
    }),
    "welcome-first-reply-v1",
  );
  assert.equal(node("Basic LLM Chain").parameters.hasOutputParser, true);
  assert.equal(node("Structured Output Parser").parameters.autoFix, false);
  assert.ok(
    workflow.nodes.every((n) => !n.continueOnFail && !n.alwaysOutputData),
  );
});
test("recheck rejects new messages, changed content and incomplete history", () => {
  const history = {
    complete: true,
    hasGaps: false,
    messages: [{ text: "welcome" }, { text: "reply" }],
  };
  const item = { history, historySnapshot: JSON.stringify(history) };
  assert.equal(unchanged(item), true);
  assert.equal(
    unchanged({
      ...item,
      history: {
        ...history,
        messages: [
          { type: "sticker" },
          ...history.messages,
          { type: "sticker" },
        ],
      },
    }),
    true,
  );
  for (const patch of [
    { complete: false },
    { hasGaps: true },
    { messages: [...history.messages, { text: "manual reply" }] },
    { messages: [{ text: "edited welcome" }, { text: "reply" }] },
  ])
    assert.equal(
      unchanged({ ...item, history: { ...history, ...patch } }),
      false,
    );
});

const configRows = () =>
  [
    "welcomeText",
    "ask_subscription",
    "explain_channel",
    "bot_question",
    "subscription_confirmed",
  ].map((name) => ({ name, message: "Text for " + name }));
test("both workflows use shared table messages, preserving exact text and event data", () => {
  const sender = require("../examples/welcome.json");
  const lookup = node("Shared Messages");
  const welcomeLookup = sender.nodes.find((n) => n.name === "Shared Welcome");
  assert.deepEqual(
    welcomeLookup.parameters.dataTableId,
    lookup.parameters.dataTableId,
  );
  assert.deepEqual(welcomeLookup.parameters.filters.conditions, [
    { keyName: "name", condition: "eq", keyValue: "welcomeText" },
  ]);
  assert.deepEqual(
    lookup.parameters.filters.conditions.map((c) => c.keyValue),
    configRows().map((r) => r.name),
  );
  assert.equal(lookup.parameters.limit, 6);
  const event = { userId: "123", eventId: "456", message: { text: "да" } };
  const rows = configRows();
  rows[0].message = " Точный welcome ❤️\n";
  const mapped = expression(
    node("Message Configuration").parameters.jsonOutput,
  )({ messages: rows }, (name) => {
    assert.equal(name, "Events");
    return { item: { json: event } };
  });
  assert.equal(mapped.eventId, event.eventId);
  assert.equal(mapped.userId, event.userId);
  assert.equal(mapped.settings.welcomeText, rows[0].message);
  assert.deepEqual(
    mapped.settings.replies,
    Object.fromEntries(rows.slice(1).map((r) => [r.name, r.message])),
  );
  const changed = rows.map((r) => ({ ...r, message: r.message + " changed" }));
  const updated = expression(
    node("Message Configuration").parameters.jsonOutput,
  )({ messages: changed }, () => ({ item: { json: event } }));
  assert.equal(updated.settings.replies.bot_question, changed[3].message);
  const sent = expression(
    sender.nodes.find((n) => n.name === "Welcome Configuration").parameters
      .jsonOutput,
  )({ message: rows[0].message }, () => ({ item: { json: event } }));
  assert.equal(sent.welcomeText, mapped.settings.welcomeText);
  assert.equal(sent.eventId, event.eventId);
});
test("shared configuration guard blocks missing, duplicate, blank and unexpected rows", () => {
  const check = expression(
    node("Valid Message Configuration").parameters.conditions.conditions[0]
      .leftValue,
  );
  const rows = configRows();
  assert.equal(check({ messages: rows }), true);
  const invalid = [
    undefined,
    [],
    rows.slice(1),
    [...rows, rows[0]],
    [rows[0], rows[1], rows[1], rows[3]],
    rows.map((r, i) => (i === 1 ? { ...r, name: "unknown" } : r)),
  ];
  for (const message of ["", "  ", null, 3])
    invalid.push(rows.map((r, i) => (i === 2 ? { ...r, message } : r)));
  for (const messages of invalid) assert.equal(check({ messages }), false);
});
test("welcome-only guard remains independent of response configuration", () => {
  const sender = require("../examples/welcome.json");
  const code = sender.nodes.find((n) => n.name === "Valid Welcome Text")
    .parameters.conditions.conditions[0].leftValue;
  const check = new Function(
    "$json",
    "$input",
    "return (" + code.slice(3, -2).trim() + ");",
  );
  const run = (message, count = 1) =>
    check({ message }, { all: () => Array(count).fill({}) });
  assert.equal(run("hello"), true);
  for (const [value, count] of [
    ["hello", 2],
    ["hello", 0],
    ["", 1],
    ["  ", 1],
    [null, 1],
    [3, 1],
  ])
    assert.equal(run(value, count), false);
});

test("subscription confirmation uses configured text and its own deduplication action", () => {
  for (const subscriptionOnly of [false, true]) {
    const original = source("alice");
    original.json.subscriptionOnly = subscriptionOnly;
    const out = run([response(decision("subscription_confirmed"))], [original]);
    assert.equal(out[0].json.replyText, "Легааа)");
    assert.equal(out[0].json.userId, "alice");
    assert.equal(
      expression(node("Your Reply").parameters.options.actionKey)(out[0].json),
      "welcome-subscription-confirmed-v1",
    );
    if (subscriptionOnly)
      for (const intent of [
        "ask_subscription",
        "explain_channel",
        "bot_question",
      ])
        assert.deepEqual(run([response(decision(intent))], [original]), []);
  }
  for (const extra of [{ unambiguous: false }, { onlyRelevant: false }])
    assert.deepEqual(
      run([response(decision("subscription_confirmed", extra))]),
      [],
    );
});

test("subscription confirmation reads edited table text and rejects empty configuration", () => {
  const original = source("alice");
  original.json.settings.replies.subscription_confirmed =
    "Новое спасибо за подписку";
  assert.equal(
    run([response(decision("subscription_confirmed"))], [original])[0].json
      .replyText,
    "Новое спасибо за подписку",
  );
  for (const value of ["", "  ", undefined, null]) {
    original.json.settings.replies.subscription_confirmed = value;
    assert.deepEqual(
      run([response(decision("subscription_confirmed"))], [original]),
      [],
    );
  }
});

test("classification distinguishes an outgoing channel invitation from user text and other replies", () => {
  const input = expression(node("Basic LLM Chain").parameters.text);
  const settings = {
    replies: { explain_channel: "Here is my channel; subscribe" },
  };
  const make = (messages) =>
    JSON.parse(
      input({ subscriptionOnly: true, settings, history: { messages } }),
    );
  const row = (direction, text, type = "text") => ({ direction, text, type });
  assert.equal(
    make([row("incoming", settings.replies.explain_channel)]).channelExplained,
    false,
  );
  assert.equal(
    make([row("outgoing", "Are you subscribed?")]).channelExplained,
    false,
  );
  assert.equal(
    make([row("outgoing", "I am not a bot")]).channelExplained,
    false,
  );
  assert.equal(
    make([row("outgoing", settings.replies.explain_channel, "sticker")])
      .channelExplained,
    false,
  );
  const result = make([
    row("outgoing", settings.replies.explain_channel),
    row("incoming", "Могу подписаться"),
  ]);
  assert.equal(result.channelExplained, true);
  assert.equal(result.messages.at(-1).text, "Могу подписаться");
});

test("subscription question permits one explanation with a separate idempotency key", () => {
  const original = source("alice");
  original.json.subscriptionOnly = true;
  original.json.allowChannelExplanation = true;
  const result = run([response(decision("explain_channel"))], [original]);
  assert.equal(result.length, 1);
  const key = expression(node("Your Reply").parameters.options.actionKey);
  assert.equal(key(result[0].json), "welcome-explain-after-subscription-v1");
  assert.equal(key({ action: "ask_subscription" }), "welcome-first-reply-v1");
  assert.equal(key({ action: "explain_channel" }), "welcome-first-reply-v1");
  assert.equal(
    key({ action: "subscription_confirmed" }),
    "welcome-subscription-confirmed-v1",
  );
  for (const intent of ["ask_subscription", "bot_question", "ignore"])
    assert.deepEqual(run([response(decision(intent))], [original]), []);
  original.json.allowChannelExplanation = false;
  assert.deepEqual(
    run([response(decision("explain_channel"))], [original]),
    [],
  );
});

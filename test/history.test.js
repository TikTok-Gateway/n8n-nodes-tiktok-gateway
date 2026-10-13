const test = require("node:test");
const assert = require("node:assert/strict");
const { TikTokEvents } = require("../dist/nodes/TikTokEvents.node");
const { TikTokGetMessages } = require("../dist/nodes/TikTokGetMessages.node");
const workflow = require("../examples/welcome-reply.json");
const gateCode = workflow.nodes.find((n) => n.name === "Welcome Reply Gate")
  .parameters.jsCode;
const firstWelcomeReply = new Function(
  gateCode.split("const output = [];")[0] + "return firstWelcomeReply;",
)();
const welcome = "Привет! Знаешь про мой тгк?";
const first = {
  messageId: "10",
  senderId: "100",
  direction: "outgoing",
  type: "text",
  text: welcome,
  sentAt: "2026-10-13T10:00:00Z",
};
const reply = {
  messageId: "30",
  senderId: "200",
  direction: "incoming",
  type: "text",
  text: "да",
  sentAt: "2026-10-13T10:02:00Z",
};
const event = {
  schemaVersion: "1",
  type: "message.received",
  eventId: "event-30",
  accountId: "100",
  userId: "200",
  conversationId: "0:1:100:200",
  messageId: "30",
  message: reply,
  occurredAt: reply.sentAt,
  detectedAt: "2026-10-13T10:02:01Z",
};
const history = {
  accountId: "100",
  userId: "200",
  conversationId: event.conversationId,
  messages: [first, reply],
  complete: true,
  hasGaps: false,
  nextCursor: "",
};
const clone = (x) => structuredClone(x);
test("first welcome reply gate rejects unrelated conversations, later replies, gaps and stale events", () => {
  assert.equal(firstWelcomeReply(history, event, welcome, false), true);
  const cases = [
    (h) => (h.complete = false),
    (h) => (h.hasGaps = true),
    (h) => (h.messages[0].text = "обычная переписка"),
    (h) => (h.messages[0].direction = "incoming"),
    (h) =>
      h.messages.unshift({
        ...first,
        messageId: "9",
        text: "older conversation",
      }),
    (h) => h.messages.push({ ...reply, messageId: "31", text: "и ещё вопрос" }),
    (h) =>
      h.messages.push({ ...first, messageId: "31", text: "manual answer" }),
    (h) => (h.messages[1].replyToMessageId = "9"),
    (h) => (h.messages[1].messageId = "31"),
    (h) => (h.messages[1].type = "sticker"),
    (h) => (h.messages[1].text = "changed after event"),
    (h) => (h.messages[1].sentAt = first.sentAt),
    (h) => (h.accountId = "101"),
    (h) => (h.conversationId = "different"),
  ];
  for (const mutate of cases) {
    const h = clone(history);
    mutate(h);
    assert.equal(
      firstWelcomeReply(h, event, welcome, true),
      false,
      String(mutate),
    );
  }
  assert.equal(
    firstWelcomeReply(
      history,
      { ...event, type: "follower.created" },
      welcome,
      false,
    ),
    false,
  );
  assert.equal(firstWelcomeReply(history, event, "", false), false);
  const h = clone(history);
  h.messages.splice(1, 0, {
    ...first,
    messageId: "20",
    type: "sticker",
    text: "[sticker]",
    sentAt: "2026-10-13T10:01:00Z",
  });
  assert.equal(firstWelcomeReply(h, event, welcome), true);
  h.messages.unshift({
    ...first,
    messageId: "1",
    type: "sticker",
    text: "old sticker",
  });
  h.messages.push({
    ...reply,
    messageId: "40",
    type: "sticker",
    text: "later sticker",
  });
  assert.equal(firstWelcomeReply(h, event, welcome), true);
  h.messages.unshift({ ...first, messageId: "2", type: "image", text: "" });
  assert.equal(firstWelcomeReply(h, event, welcome), false);
});
function ctx(pages, parameters = {}) {
  const calls = [];
  let page = 0;
  return {
    calls,
    getInputData: () => [
      {
        json: clone(event),
        binary: { a: { data: "YQ==", mimeType: "text/plain" } },
      },
    ],
    getNode: () => ({ id: "history", name: "History" }),
    getCredentials: async () => ({ url: "http://gateway", apiToken: "secret" }),
    getNodeParameter: (name, index, fallback) =>
      ({
        recipient: "200",
        maxPages: 10,
        ...parameters,
      })[name] ?? fallback,
    helpers: {
      httpRequest: async (r) => {
        calls.push(r);
        return clone(pages[page++]);
      },
    },
  };
}
const page = (messages, nextCursor = "", exhausted = false) => ({
  accountId: "100",
  userId: "200",
  conversationId: event.conversationId,
  messages,
  nextCursor,
  exhausted,
  hasGaps: false,
});
test("Get Messages paginates, deduplicates, sorts, preserves trigger and item links; only GET", async () => {
  const c = ctx([
    page([reply], "20"),
    page([reply, first], "10"),
    page([], "", true),
  ]);
  const result = await new TikTokGetMessages().execute.call(c);
  assert.equal(result[0].length, 1);
  assert.deepEqual(result[0][0].json.history.messages, [first, reply]);
  assert.equal(result[0][0].json.messageId, "30");
  assert.equal(result[0][0].pairedItem.item, 0);
  assert.equal(result[0][0].binary.a.data, "YQ==");
  assert(c.calls.every((r) => r.method === "GET"));
  assert.match(c.calls[1].url, /cursor=20/);
});
test("incomplete, missing cursor, hidden rows and pagination loops cannot pass welcome filter", async () => {
  for (const pages of [
    [page([first, reply], "10")],
    [page([first, reply], "")],
    [page([first, reply], "10"), page([first], "10")],
    [{ ...page([first, reply], "10"), hasGaps: true }, page([], "", true)],
  ]) {
    const c = ctx(pages, { maxPages: pages.length });
    const result = await new TikTokGetMessages().execute.call(c);
    assert.equal(result[0].length, 1);
    assert.equal(
      firstWelcomeReply(result[0][0].json.history, event, welcome, false),
      false,
    );
  }
  const c = ctx([page([first, reply], "10")], {
    maxPages: 1,
  });
  assert.equal(
    (await new TikTokGetMessages().execute.call(c))[0][0].json.history.complete,
    false,
  );
});
test("malformed/foreign/changing history fails closed", async () => {
  for (const pages of [
    [null],
    [{ ...page([], "", true), accountId: "999" }],
    [{ ...page([reply], "10"), messages: [{ ...reply, senderId: "999" }] }],
    [page([reply], "10"), page([{ ...reply, text: "changed" }], "5")],
    [page([reply], "", true)],
  ]) {
    await assert.rejects(
      () => new TikTokGetMessages().execute.call(ctx(pages)),
      /history|History/,
    );
  }
});
test("Events authenticates and separates followers/messages, strips extra fields, ignores unsupported types", async () => {
  let status = 0;
  const body = {
    schemaVersion: "1",
    eventId: event.eventId,
    type: event.type,
    accountId: event.accountId,
    occurredAt: event.occurredAt,
    detectedAt: event.detectedAt,
    data: {
      userId: event.userId,
      conversationId: event.conversationId,
      messageId: event.messageId,
      message: { ...reply, privateURL: "secret" },
    },
  };
  const req = { headers: { authorization: "Bearer hook" }, body };
  const c = {
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
  const n = new TikTokEvents();
  let result = await n.webhook.call(c);
  assert.equal(status, 200);
  assert.equal(result.workflowData[0].length, 0);
  assert.equal(result.workflowData[1][0].json.messageId, "30");
  assert(!JSON.stringify(result).includes("secret"));
  req.body.data.message.senderId = "100";
  await n.webhook.call(c);
  assert.equal(status, 400);
  req.body.type = "follower.created";
  result = await n.webhook.call(c);
  assert.equal(status, 200);
  assert.equal(result.workflowData[0].length, 1);
  assert.equal(result.workflowData[1].length, 0);
  req.body.schemaVersion = "2";
  await n.webhook.call(c);
  assert.equal(status, 204);
  req.headers.authorization = "Bearer nope";
  await n.webhook.call(c);
  assert.equal(status, 401);
});
test("generic Get Messages has no scenario parameters and returns ordinary conversations", async () => {
  const n = new TikTokGetMessages();
  assert.ok(!n.description.properties.some((p) => /welcome/i.test(p.name)));
  const c = ctx([
    page([{ ...first, text: "ordinary chat" }, reply], "10"),
    page([], "", true),
  ]);
  const out = await n.execute.call(c);
  assert.equal(out[0].length, 1);
  assert.equal(out[0][0].json.history.messages[0].text, "ordinary chat");
});

test("first reply can contain multiple consecutive incoming texts, newest event only", () => {
  const second = {
    ...reply,
    messageId: "31",
    text: "А что",
    sentAt: "2026-10-13T10:02:02Z",
    replyToMessageId: reply.messageId,
  };
  const h = {
    ...clone(history),
    messages: [clone(first), clone(reply), second],
  };
  const lastEvent = {
    ...clone(event),
    messageId: second.messageId,
    message: second,
  };
  assert.equal(firstWelcomeReply(h, lastEvent, welcome), true);
  assert.equal(firstWelcomeReply(h, event, welcome), false);
  assert.equal(
    firstWelcomeReply(
      { ...h, messages: [first, reply, { ...first, messageId: "25" }, second] },
      lastEvent,
      welcome,
    ),
    false,
  );
  assert.equal(
    firstWelcomeReply(
      { ...h, messages: [first, { ...reply, senderId: "999" }, second] },
      lastEvent,
      welcome,
    ),
    false,
  );
  assert.equal(
    firstWelcomeReply(
      { ...h, messages: [first, { ...reply, text: "x".repeat(2000) }, second] },
      lastEvent,
      welcome,
    ),
    false,
  );
  assert.equal(
    firstWelcomeReply(
      {
        ...h,
        messages: [first, reply, { ...second, replyToMessageId: "unrelated" }],
      },
      lastEvent,
      welcome,
    ),
    false,
  );
});

test("all events of a first-reply burst use the same outgoing idempotency group", () => {
  const run = (h, ev) =>
    new Function("$input", gateCode)({
      all: () => [
        { json: { ...ev, history: h, settings: { welcomeText: welcome } } },
      ],
    });
  const second = {
    ...reply,
    messageId: "31",
    text: "А что",
    sentAt: "2026-10-13T10:02:02Z",
  };
  const a = run(history, event)[0].json;
  const b = run(
    { ...history, messages: [first, reply, second] },
    { ...event, eventId: "event-31", messageId: "31", message: second },
  )[0].json;
  assert.equal(a.replyGroupKey, b.replyGroupKey);
  assert.equal(
    workflow.nodes.find((n) => n.name === "Your Reply").parameters.options
      .eventId,
    "={{ $json.replyGroupKey }}",
  );
});

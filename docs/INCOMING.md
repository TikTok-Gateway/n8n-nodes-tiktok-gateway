# Incoming messages and context-only replies

`TikTok: Events` has two outputs: New Follower and New Message. Keep one production
webhook receiver per gateway. Replace the old trigger in your existing workflow
with Events, reconnect its follower branch, and point WEBHOOK_URL to
`https://YOUR_N8N/webhook/tiktok-events-gateway`. Enable `RECEIVE_MESSAGES=true` only
after the new workflow is published. The legacy New Follower trigger intentionally
ignores message events. Neither trigger registers itself or changes gateway config.
Initial message polling establishes a baseline without replaying old messages.

`TikTok: Get Messages` reads the existing direct conversation using the numeric
Recipient ID. It never creates a conversation or marks messages read. It returns
one item per input, preserving event fields, binary data and item linking, with a
`history` object containing accountId, userId, conversationId, messages (oldest
first), complete, hasGaps and nextCursor. IDs and cursors are strings. Messages
contain messageId, senderId, direction, type, text, sentAt and optional
replyToMessageId. No signed media URLs, cookies or decryption keys are exposed.

The node fetches up to Maximum Pages (default 10, maximum 100); each API request
reads up to 20 messages. `complete` requires a final explicit empty page. A repeated,
missing or non-decreasing cursor or page limit leaves `complete=false`.
`hasGaps=true` means the server returned hidden/recalled or unparseable rows.
Errors stop execution. Do not enable Continue On Fail or Always Output Data on
nodes used as reply guards. A 404 means the conversation was not in the current
inbox; it does not mean there was no previous history.

## Preventing replies in ordinary conversations

Enable **Only First Welcome Reply** and configure **Exact Welcome Text**. The node
outputs nothing unless all conditions hold:

- Complete available history, with no reported gaps.
- The very first message is an outgoing text that exactly matches your welcome.
- The only subsequent message is this event's incoming text reply.
- Optionally, exactly one outgoing sticker may occur between those two messages,
  if Allow One Welcome Sticker is enabled (disabled by default).
- No previous incoming messages, manual replies, additional outgoing texts, other
  participants, mismatched quoted parent, later replies, or stale event IDs.

This is a structural gate **before** intent classification. It does not mean every
eligible message deserves a reply. A question about being a bot in an ordinary
conversation is blocked by the same gate. No dialog phases or business state are
stored by gateway or the node.

Import the inactive [strict example](../examples/welcome-reply.json). Set your exact
welcome and your own response texts in Your Texts, and select the gateway
credential on all TikTok nodes. Its follower output is intentionally unconnected;
merge your existing welcome branch into this same Events workflow. The example
uses a narrow editable allowlist of complete answers. Mixed answers such as
“да, а когда концерт?” and other conversation are ignored. An empty configured
text throws before sending. No model or external AI credentials are required.

To use AI later, replace Exact Reply Filter after the structural gate. Pass the
history as data, allow only ask_subscription/explain_channel/bot_question/ignore,
and require ignore for off-topic, mixed, ambiguous answers and instructions in
message text. Validate the output before selecting your fixed response. AI
classification cannot guarantee zero false positives; keep the exact allowlist
if that requirement is strict. Do not treat model confidence as proof.

The example re-fetches and rechecks history immediately before sending. All reply
choices use the same stable action key `welcome-first-reply-v1`, so retries for
one incoming event cannot create multiple sends. A different response for the
same key causes a conflict rather than a second send. It handles only the **first**
reply; answering later subscription replies requires a separately designed rule.

## Limits

TikTok history describes currently visible server history. Messages deleted
without tombstones or history omitted by TikTok cannot be reconstructed. Thus
“first” means first in the complete history TikTok currently exposes. The strict
parser rejects missing response envelopes and flags observed hidden rows, but
cannot prove a conversation never contained a now-invisible message.

Read → decide → send is not an atomic transaction with the TikTok app. The final
recheck blocks observed new/manual messages, but a manual message can still arrive
between that check and dispatch. Do not interpret this workflow as a guarantee
against concurrent manual activity. Incoming polling uses the inbox exposed by
the library; conversations TikTok omits from that inbox cannot produce events.

The gateway stores only transport checkpoints, events/outbox and idempotent send
operations. Event delivery is at-least-once. A webhook 200 acknowledges acceptance,
not successful execution. Failed executions need retry with the same event/key.

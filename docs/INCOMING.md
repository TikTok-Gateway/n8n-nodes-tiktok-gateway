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

Get Messages is a generic history reader. It always returns validated history,
including ordinary conversations and incomplete pages with explicit flags.
The example workflow uses **Welcome Reply Gate**, its only Code node, to check:

- Complete available history, with no reported gaps.
- After ignoring stickers, the first message is an outgoing text that exactly matches your shared welcome.
- Subsequent messages are incoming texts from this user or outgoing texts exactly matching configured `ask_subscription`, `explain_channel`, or `bot_question` replies. The current incoming series has a 2000-character limit. Only the event for the latest text may proceed; earlier events stop.
- All stickers, in either direction and anywhere in history, are ignored. Other media still counts and blocks this first-reply scenario.
- No previous incoming messages, manual replies, unrecognized outgoing texts, other
  participants, mismatched quoted parent, or stale event IDs.

A five-second Wait before reading history gives adjacent messages time to arrive. This is a structural gate **before** intent classification. It does not mean every
eligible message deserves a reply. A question about being a bot in an ordinary
conversation is blocked by the same gate. No dialog phases or business state are
stored by gateway or the node.

Import the inactive [strict example](../examples/welcome-reply.json). Create a **TikTok Settings** Data Table in the same n8n project, add string columns **name** and **message**, and add a row with **name=welcomeText** and your exact welcome in **message**. The welcome sender queries this name through **Shared Welcome**, followed by **Valid Welcome Text** (IF). The reply workflow loads five names through **Shared Messages**: `welcomeText`, `ask_subscription`, `explain_channel`, `bot_question`, and `subscription_confirmed`. **Collect Messages** (Aggregate) combines rows into one item; **Valid Message Configuration** (IF) requires exactly one non-empty entry for each name. Missing, duplicate or empty entries stop the branch. **Message Configuration** (Edit Fields) maps these rows while preserving the triggering event. Numeric row IDs are not used by the workflows. Other names can store additional messages. The table stores configuration, not dialog state. Changing the text means older welcomes no longer match.

Add your four response texts as rows named `ask_subscription`, `explain_channel`, `bot_question`, and `subscription_confirmed` in the same table, and select the gateway
credential on all TikTok nodes. Its follower output is intentionally unconnected;
merge your existing welcome branch into this same Events workflow. The example
uses an OpenAI-compatible LLM classifier after the first structural gate.

Configure **Chat Model**: select an OpenAI credential with your provider's Base URL
(including `/v1`) and API key, then enter the model ID. Responses API is disabled
for OpenAI-compatible Chat Completions providers. Credentials are intentionally unset; choose the provider-specific model ID. Edit all message texts in the shared Data Table; the workflow stays inactive.

An expression in **Basic LLM Chain** passes only eligible history direction, type
and text to the model. IDs and configured response texts remain local.
The chain has **Chat Model** and **Structured Output Parser** attached. The parser
uses a manual JSON Schema with a single enum intent and two required booleans;
Auto-Fix and model fallback are disabled. Model/parser errors stop execution.

The model selects `ask_subscription`, `explain_channel`, `bot_question`, `subscription_confirmed`, or `ignore`.
A clear answer about the channel remains eligible when accompanied by an unrelated question: “Привет,не” followed by “Хочешь огонек?” selects `explain_channel`. Requests to explain the channel also select it. Contradictory relevant answers, opt-outs, prompt instructions, uncertainty, and unrelated messages without a clear channel answer produce `ignore`. The classifier receives `channelExplained`, derived from an outgoing message matching the configured `explain_channel` text. Before that invitation, “Эм нет” + “Могу подписаться” selects `explain_channel`; after it, “Могу подписаться” accepts the invitation and selects the closing `subscription_confirmed`. Promises to visit or subscribe follow the same stage rule. An explicit already-completed subscription can close at any stage. Mere thanks, “может зайду”, and requests for help do not close the dialog. `subscriptionOnly` alone does not establish that the channel was explained. **Clear Relevant Intent** (IF) checks the
parser's `output` object again: exactly `intent`, `unambiguous`, `onlyRelevant`,
an allowed intent and both flags literally `true`. No text/string fallback is
accepted. Empty response texts, `ignore` and ambiguous results yield no output.
These flags apply to the selected relevant part of the reply, even when an additional topic is present; they are not proof that the model is correct.
The native chain does not expose raw provider finish/refusal metadata downstream;
validation now relies on the required parsed object rather than HTTP envelope fields.

The model never writes the outgoing reply or supplies a recipient: the validator
uses **Select Your Reply** (Edit Fields) with the linked original item to select
only your configured response text.
AI classification cannot guarantee zero false positives. Test the chosen model
with synthetic clear, off-topic, ambiguous and adversarial examples before enabling.
Do not execute the production send path just to test classification.

The example re-fetches history immediately before sending. **History Unchanged**
(IF) requires complete, gap-free history identical to the snapshot that passed
Welcome Reply Gate, excluding stickers. Any additional or edited non-sticker message cancels that attempt. The latest incoming event reclassifies the entire current series with the updated policy; an unrelated addition no longer erases a clear channel answer. The original reply
choices use action key `welcome-first-reply-v1` and an event-ID override derived from account, recipient and the welcome message ID. Concurrent events and retries for the same first-reply group therefore share one idempotency key. A different response for the
same key causes a conflict rather than a second send. The `subscription_confirmed` intent sends the configured `subscription_confirmed` text (initially **Легааа)**) with its own action key `welcome-subscription-confirmed-v1`, sharing the welcome-based event group so it can be sent only once per welcome. It is allowed directly after welcome or after any configured automatic reply. After a later outgoing reply, the result gate normally allows only this intent. Exception: after `ask_subscription`, before any `explain_channel`, `allowChannelExplanation` permits `explain_channel` for “Нет, могу подписаться”, a negative subscription answer, or a request for the channel link. This follow-up uses `welcome-explain-after-subscription-v1` so it does not conflict with the earlier question’s `welcome-first-reply-v1` key. Once the explanation has been sent, it cannot repeat; acceptance can then close with `subscription_confirmed`. The model evaluates the latest incoming series using earlier messages as context. A previous **Легааа)** or an unrecognized outgoing text stops the branch. Outgoing automatic messages are recognized by exact configured text; editing configuration may stop older conversations from matching. Store **Легааа)** in the `subscription_confirmed` row of TikTok Settings. This text is editable like every other reply.

## Persistent dialog state

The reply example requires a second Data Table, **TikTok Dialogs**, in the same n8n project. Create these **string** columns (keep TikTok IDs as strings):

| Column | Meaning |
| --- | --- |
| `account_id` | Gateway account ID |
| `user_id` | Recipient ID |
| `status` | `open`, `paused`, or `closed` |
| `closed_at` | ISO timestamp of the recorded closure; empty for a manual pause |

Start with an empty table. No row or `open` allows processing. Use one row per account/user pair. `closed` permanently suppresses this reply workflow for that user in that account, including subsequent welcomes. `paused` provides a manual suspension; change it to `open` to resume. Do not automatically write intermediate stages: a concurrent older execution must never reopen a closed dialog. History remains the source for conversational stages and send eligibility. Reopening a closed row alone does not bypass the existing history guard against a previous closing reply.

The incoming branch first runs **Not Closed At Entry** and **Not Paused At Entry**. These native Data Table existence guards preserve the event when no matching row exists and return zero items otherwise. Closed/paused users therefore do not reach the burst wait, message configuration, history or model. The guards are repeated after the wait and immediately before sending to catch closures/pauses made while an execution was running. A blocking row wins even if duplicate rows exist. Table access failures stop execution rather than allowing processing.

Only **Your Reply → Sent → Closing Reply Sent** with `action=subscription_confirmed` and `state=succeeded` reaches **Close Dialog**. It upserts `closed` and `closed_at` using both account and user as the match key. Skipped/failed sends and other reply actions do not write state. The write retries three times on failure; if it still fails, fix table access and retry the failed write with the successful send data. Sending and storing state are not one transaction: a crash between them can leave the row open. The existing history guard still prevents a repeated closing response, but the early drop is only effective once the row is saved. Concurrent sends remain protected by the existing idempotency keys; the status checks are not a lock.

There are no notification nodes in this exported example. Add any notifications only downstream of the status guards; recheck state immediately before delayed notifications. A separate notification workflow must use the same table and guards. Already-sent notifications cannot be recalled. The gateway still emits events and n8n still records short executions for dropped messages.

Existing conversations are not automatically backfilled: users who received `subscription_confirmed` before this change retain the history-based stop until you add their `closed` rows. Populate those only from verified successful sends. Import the updated example and create the table before enabling it; importing JSON alone does not create a Data Table or modify an already deployed workflow.

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

## Migration from 0.2.0

Version 0.3.0 removes `onlyFirstWelcomeReply`, `welcomeText`, and
`allowWelcomeSticker` from Get Messages. Move these rules into your workflow
before upgrading; old parameters no longer filter anything. The included inactive
example has the scenario guard and recheck in the workflow. No gateway API change
or server upgrade is needed.

Short affirmative replies are interpreted in context: after the latest `explain_channel` invitation, “Ок”, “хорошо”, “ага”, “давай”, and similar acceptance select `subscription_confirmed` without repeating “subscribe” or “visit”. These are examples, not a keyword list. Refusals, uncertainty, mere acknowledgment (“понятно”, “спасибо”), and agreement with another topic do not close the dialog. Before the invitation, the current question determines the meaning.

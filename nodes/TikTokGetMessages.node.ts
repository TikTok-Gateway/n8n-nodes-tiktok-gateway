import { NodeOperationError } from "n8n-workflow";
import type {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
} from "n8n-workflow";
import { credentials, common, request } from "./shared";
import {
  numericID,
  validMessage,
  firstWelcomeReply,
  History,
  HistoryMessage,
} from "./history";

export class TikTokGetMessages implements INodeType {
  description: INodeTypeDescription = {
    displayName: "TikTok: Get Messages",
    name: "tikTokGetMessages",
    group: ["transform"],
    version: 1,
    icon: "file:tiktok.png",
    description:
      "Read direct-message history without creating a conversation or marking it read",
    defaults: { name: "Get Messages" },
    inputs: ["main"],
    outputs: ["main"],
    credentials,
    properties: [
      ...common,
      {
        displayName: "Maximum Pages",
        name: "maxPages",
        type: "number",
        default: 10,
        typeOptions: { minValue: 1, maxValue: 100 },
        description:
          "Fetch newest to oldest, up to 20 messages per page. A final empty page is needed to prove exhaustion. Incomplete history is never eligible for the welcome filter.",
      },
      {
        displayName: "Only First Welcome Reply",
        name: "onlyFirstWelcomeReply",
        type: "boolean",
        default: false,
        description:
          "Whether to output only a first text reply to the exact opening welcome. Blocks incomplete histories, other conversations, and later replies. Apply an intent filter before sending.",
      },
      {
        displayName: "Exact Welcome Text",
        name: "welcomeText",
        type: "string",
        default: "",
        typeOptions: { rows: 4 },
        displayOptions: { show: { onlyFirstWelcomeReply: [true] } },
        description:
          "Must match the first outgoing message exactly. An empty value stops execution.",
      },
      {
        displayName: "Allow One Welcome Sticker",
        name: "allowWelcomeSticker",
        type: "boolean",
        default: false,
        displayOptions: { show: { onlyFirstWelcomeReply: [true] } },
        description:
          "Whether to allow exactly one outgoing sticker between the welcome and the first reply",
      },
    ],
  };
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData(),
      out: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      const fail = (message: string): never => {
        throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
      };
      const user = this.getNodeParameter("recipient", i);
      const maxPages = Number(this.getNodeParameter("maxPages", i, 10));
      const filter =
        this.getNodeParameter("onlyFirstWelcomeReply", i, false) === true;
      const welcome = String(this.getNodeParameter("welcomeText", i, ""));
      if (!numericID(user))
        fail("Provide the numeric recipient ID as a string.");
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
        fail("Maximum Pages must be between 1 and 100.");
      if (filter && !welcome.trim())
        fail("Set the exact welcome text before enabling this filter.");
      let cursor = "",
        history: History | undefined;
      const seen = new Map<string, HistoryMessage>();
      for (let p = 0; p < maxPages; p++) {
        const value = await request(
          this,
          "GET",
          `/v1/conversations/${encodeURIComponent(String(user))}/messages${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
        );
        const page = value as {
          accountId: string;
          userId: string;
          conversationId: string;
          messages: HistoryMessage[];
          nextCursor: string;
          exhausted: boolean;
          hasGaps: boolean;
        };
        if (
          !page ||
          !numericID(page.accountId) ||
          page.accountId === user ||
          page.userId !== user ||
          typeof page.conversationId !== "string" ||
          !page.conversationId ||
          !Array.isArray(page.messages) ||
          page.messages.length > 100 ||
          page.messages.some((m) => !validMessage(m, page.accountId, user)) ||
          typeof page.exhausted !== "boolean" ||
          typeof page.hasGaps !== "boolean" ||
          typeof page.nextCursor !== "string" ||
          (page.nextCursor !== "" && !numericID(page.nextCursor)) ||
          (page.exhausted &&
            (page.messages.length > 0 || page.nextCursor !== ""))
        )
          fail("Invalid gateway history response.");
        if (!history)
          history = {
            accountId: page.accountId,
            userId: page.userId,
            conversationId: page.conversationId,
            messages: [],
            complete: false,
            hasGaps: false,
            nextCursor: "",
          };
        if (
          page.accountId !== history.accountId ||
          page.conversationId !== history.conversationId ||
          (items[i].json.accountId !== undefined &&
            items[i].json.accountId !== page.accountId) ||
          (items[i].json.conversationId !== undefined &&
            items[i].json.conversationId !== page.conversationId)
        )
          fail("History does not match the source conversation.");
        history.hasGaps ||= page.hasGaps;
        for (const m of page.messages) {
          const clean: HistoryMessage = {
            messageId: m.messageId,
            senderId: m.senderId,
            direction: m.direction,
            type: m.type,
            text: m.text,
            sentAt: m.sentAt,
            ...(m.replyToMessageId
              ? { replyToMessageId: m.replyToMessageId }
              : {}),
          };
          const previous = seen.get(m.messageId);
          if (previous && JSON.stringify(previous) !== JSON.stringify(clean))
            fail(
              "History changed during pagination. Read it again before deciding to reply.",
            );
          seen.set(m.messageId, clean);
        }
        history.nextCursor = page.nextCursor;
        if (page.exhausted) {
          history.complete = true;
          break;
        }
        if (
          !page.nextCursor ||
          (cursor && BigInt(page.nextCursor) >= BigInt(cursor))
        )
          break;
        cursor = page.nextCursor;
      }
      if (!history) fail("No history response.");
      const result = history!;
      result.messages = [...seen.values()].sort(
        (a, b) =>
          Date.parse(a.sentAt) - Date.parse(b.sentAt) ||
          (BigInt(a.messageId) < BigInt(b.messageId) ? -1 : 1),
      );
      if (
        filter &&
        !firstWelcomeReply(
          result,
          items[i].json,
          welcome,
          this.getNodeParameter("allowWelcomeSticker", i, false) === true,
        )
      )
        continue;
      out.push({
        ...items[i],
        json: { ...items[i].json, history: result },
        pairedItem: { item: i },
      });
    }
    return [out];
  }
}

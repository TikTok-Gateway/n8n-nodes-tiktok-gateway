import type {
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IDataObject,
} from "n8n-workflow";
import { timingSafeEqual } from "node:crypto";
import { credentials } from "./shared";
import { validMessage, numericID, validTime } from "./history";

export class TikTokEvents implements INodeType {
  description: INodeTypeDescription = {
    displayName: "TikTok: Events",
    name: "tikTokEvents",
    group: ["trigger"],
    version: 1,
    icon: "file:tiktok.png",
    description: "Receive authenticated follower and direct-message events",
    defaults: { name: "Events" },
    inputs: [],
    outputs: ["main", "main"],
    outputNames: ["New Follower", "New Message"],
    credentials,
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "responseNode",
        isFullPath: true,
        path: "tiktok-events-gateway",
      },
    ],
    properties: [
      {
        displayName:
          "Use one active Events workflow per gateway. Set WEBHOOK_URL to this production URL and enable RECEIVE_MESSAGES in the gateway. This trigger does not change gateway configuration.",
        name: "notice",
        type: "notice",
        default: "",
      },
    ],
  };
  async webhook(this: IWebhookFunctions) {
    const req = this.getRequestObject(),
      res = this.getResponseObject();
    const c = await this.getCredentials("tikTokGatewayApi");
    const got = Buffer.from(String(req.headers.authorization || "")),
      want = Buffer.from("Bearer " + c.webhookToken);
    if (
      !c.webhookToken ||
      got.length !== want.length ||
      !timingSafeEqual(got, want)
    ) {
      res.status(401).json({ error: "unauthorized" });
      return { noWebhookResponse: true };
    }
    const b = req.body;
    if (
      b?.schemaVersion !== "1" ||
      !["follower.created", "message.received"].includes(b?.type)
    ) {
      res.status(204).end();
      return { noWebhookResponse: true };
    }
    const data = b.data;
    if (
      typeof b.eventId !== "string" ||
      !b.eventId.trim() ||
      b.eventId.length > 200 ||
      /[^\x20-\x7E]/.test(b.eventId) ||
      !numericID(b.accountId) ||
      !numericID(data?.userId) ||
      b.accountId === data.userId ||
      !validTime(b.occurredAt) ||
      !validTime(b.detectedAt) ||
      (data.username !== undefined && typeof data.username !== "string") ||
      (b.type === "message.received" &&
        (typeof data.conversationId !== "string" ||
          !data.conversationId ||
          data.conversationId.length > 200 ||
          !validMessage(data.message, b.accountId, data.userId) ||
          data.message.direction !== "incoming" ||
          data.messageId !== data.message.messageId ||
          data.message.sentAt !== b.occurredAt))
    ) {
      res.status(400).json({ error: "invalid_event" });
      return { noWebhookResponse: true };
    }
    const json: IDataObject = {
      schemaVersion: "1",
      type: b.type,
      eventId: b.eventId,
      userId: data.userId,
      accountId: b.accountId,
      occurredAt: b.occurredAt,
      detectedAt: b.detectedAt,
    };
    if (b.type === "follower.created") json.username = data.username || "";
    else {
      json.conversationId = data.conversationId;
      json.messageId = data.messageId;
      json.message = cleanMessage(data.message);
    }
    res.status(200).json({ accepted: true });
    return {
      noWebhookResponse: true,
      workflowData:
        b.type === "follower.created" ? [[{ json }], []] : [[], [{ json }]],
    };
  }
}
function cleanMessage(m: IDataObject): IDataObject {
  return {
    messageId: m.messageId,
    senderId: m.senderId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    sentAt: m.sentAt,
    ...(m.replyToMessageId ? { replyToMessageId: m.replyToMessageId } : {}),
  };
}

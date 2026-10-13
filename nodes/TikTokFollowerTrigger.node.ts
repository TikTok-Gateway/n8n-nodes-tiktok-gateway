import type {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  IWebhookFunctions,
  ILoadOptionsFunctions,
} from "n8n-workflow";
import { timingSafeEqual } from "node:crypto";
import { credentials } from "./shared";
export class TikTokFollowerTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "TikTok: New Follower",
    name: "tikTokFollowerTrigger",
    group: ["trigger"],
    version: 1,
    icon: "file:tiktok.png",
    description: "Start a workflow when someone follows the account",
    defaults: { name: "New Follower" },
    inputs: [],
    outputs: ["main"],
    credentials,
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "responseNode",
        isFullPath: true,
        path: "tiktok-follower-gateway",
      },
    ],
    properties: [
      {
        displayName:
          "Publish this workflow to receive new followers. Use one active trigger per gateway and add any branches within this workflow.",
        name: "notice",
        type: "notice",
        default: "",
      },
    ],
  };
  async webhook(this: IWebhookFunctions) {
    const req = this.getRequestObject();
    const res = this.getResponseObject();
    const c = await this.getCredentials("tikTokGatewayApi");
    const received = Buffer.from(String(req.headers.authorization || ""));
    const expected = Buffer.from("Bearer " + c.webhookToken);
    if (
      !c.webhookToken ||
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      res.status(401).json({ error: "unauthorized" });
      return { noWebhookResponse: true };
    }
    const b = req.body;
    if (b?.schemaVersion !== "1" || b?.type !== "follower.created") {
      res.status(204).end();
      return { noWebhookResponse: true };
    }
    if (
      typeof b.eventId !== "string" ||
      !b.eventId.trim() ||
      b.eventId.length > 200 ||
      /[^\x20-\x7E]/.test(b.eventId) ||
      typeof b.accountId !== "string" ||
      !/^[1-9]\d*$/.test(b.accountId) ||
      !["occurredAt", "detectedAt"].every(
        (k) =>
          typeof b[k] === "string" &&
          /^\d{4}-\d{2}-\d{2}T/.test(b[k]) &&
          Number.isFinite(Date.parse(b[k])),
      ) ||
      (b.data?.username !== undefined && typeof b.data.username !== "string") ||
      typeof b.data?.userId !== "string" ||
      !/^[1-9]\d*$/.test(b.data.userId)
    ) {
      res.status(400).json({ error: "invalid_event" });
      return { noWebhookResponse: true };
    }
    res.status(200).json({ accepted: true });
    return {
      noWebhookResponse: true,
      workflowData: [
        [
          {
            json: {
              schemaVersion: "1",
              type: "follower.created",
              eventId: b.eventId,
              userId: b.data.userId,
              username: b.data.username || "",
              accountId: b.accountId,
              occurredAt: b.occurredAt,
              detectedAt: b.detectedAt,
            },
          },
        ],
      ],
    };
  }
}

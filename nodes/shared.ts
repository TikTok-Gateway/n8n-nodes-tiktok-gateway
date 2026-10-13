import { NodeOperationError } from "n8n-workflow";
import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeProperties,
  INodeExecutionData,
  IDataObject,
  IHttpRequestMethods,
} from "n8n-workflow";
export const credentials = [{ name: "tikTokGatewayApi", required: true }];
export const common: INodeProperties[] = [
  {
    displayName: "Recipient",
    name: "recipient",
    type: "string",
    default: "={{ $json.userId }}",
    required: true,
    description:
      "Numeric TikTok user ID, automatically taken from the new follower",
  },
];
export const advanced: INodeProperties = {
  displayName: "Options",
  name: "options",
  type: "collection",
  default: {},
  placeholder: "Add Option",
  options: [
    {
      displayName: "Event ID",
      name: "eventId",
      type: "string",
      default: "={{ $json.eventId }}",
      description: "Stable source event ID used to prevent duplicate sends",
    },
    {
      displayName: "Action Key",
      name: "actionKey",
      type: "string",
      default: "",
      description:
        "Defaults to workflow ID:node ID. Preserve the original key during migration and retries.",
    },
    {
      displayName: "Wait Timeout (Seconds)",
      name: "timeout",
      type: "number",
      default: 300,
      typeOptions: { minValue: 5, maxValue: 3600 },
      description:
        "A timeout does not cancel an accepted command. Retry with the same event ID and action key.",
    },
  ],
};
type Context = IExecuteFunctions | ILoadOptionsFunctions;
export async function request(
  ctx: Context,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
  key?: string,
): Promise<unknown> {
  const c = await ctx.getCredentials("tikTokGatewayApi");
  let url: URL;
  try {
    url = new URL(String(c.url));
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new NodeOperationError(
      ctx.getNode(),
      "Provide a valid HTTP(S) gateway URL without embedded credentials, query, or fragment.",
    );
  }
  try {
    return await ctx.helpers.httpRequest({
      method,
      url: url.toString().replace(/\/$/, "") + path,
      headers: {
        Authorization: "Bearer " + c.apiToken,
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body } : {}),
      json: true,
      timeout: 15000,
      disableFollowRedirect: true,
    });
  } catch (error) {
    const e = error as {
      statusCode?: unknown;
      response?: { status?: unknown };
      httpCode?: unknown;
    };
    const code = Number(e.statusCode || e.response?.status || e.httpCode);
    const status =
      Number.isInteger(code) && code >= 100 && code <= 599
        ? `HTTP ${code}`
        : "no response";
    throw new NodeOperationError(
      ctx.getNode(),
      `Gateway: ${status}. The command may have been accepted; retry only with the same event ID and action key.`,
    );
  }
}
interface Operation {
  operationId: string;
  state: string;
  reason?: string;
  messageId?: string;
  tiktokRejection?: { status?: number; check?: number };
}
function operation(
  ctx: Context,
  value: unknown,
  expectedId?: string,
): Operation {
  const op = value as Operation | null;
  if (
    !op ||
    typeof op.operationId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(op.operationId) ||
    ![
      "queued",
      "sending",
      "verifying",
      "succeeded",
      "failed",
      "uncertain",
    ].includes(op.state) ||
    (expectedId && op.operationId !== expectedId)
  ) {
    throw new NodeOperationError(
      ctx.getNode(),
      `Invalid gateway operation response${expectedId ? ` for operation ${expectedId}` : ""}. The command may have been accepted. Keep the same key when retrying.`,
    );
  }
  return op;
}
export async function execute(
  this: IExecuteFunctions,
  kind: "text" | "sticker",
): Promise<INodeExecutionData[][]> {
  const input = this.getInputData();
  const out: INodeExecutionData[] = [];
  for (let i = 0; i < input.length; i++) {
    const options = this.getNodeParameter("options", i, {}) as IDataObject;
    const recipient = this.getNodeParameter("recipient", i);
    const eventId = options.eventId ?? input[i].json.eventId;
    const fail = (message: string): never => {
      throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
    };
    if (typeof recipient !== "string" || !/^[1-9]\d*$/.test(recipient))
      fail("Provide the numeric recipient ID as a string.");
    if (typeof eventId !== "string" || !eventId.trim())
      fail("Missing event ID. Connect this node to the New Follower trigger.");
    const action =
      options.actionKey || `${this.getWorkflow().id}:${this.getNode().id}`;
    if (typeof action !== "string" || /[\r\n]/.test(action))
      fail("Provide a stable action key as a string.");
    if (!options.actionKey && (!this.getWorkflow().id || !this.getNode().id))
      fail(
        "Save the workflow before sending or provide its original action key.",
      );
    const key = `${eventId}:${action}`;
    if (key.length > 256 || /[^\x20-\x7E]/.test(key))
      fail(
        "The idempotency key must contain at most 256 printable ASCII characters.",
      );
    const body: IDataObject = { recipientUserId: recipient, type: kind };
    if (kind === "text") {
      const text = this.getNodeParameter("text", i);
      if (
        typeof text !== "string" ||
        [...text].length < 1 ||
        [...text].length > 1000
      )
        fail("Text must contain between 1 and 1000 characters.");
      body.text = text;
    } else {
      const sticker = this.getNodeParameter("stickerId", i);
      if (typeof sticker !== "string" || !/^[1-9]\d*$/.test(sticker))
        fail("Choose a numeric sticker ID from the gateway catalog.");
      body.stickerId = sticker;
    }
    let op = operation(
      this,
      await request(this, "POST", "/v1/messages", body, key),
    );
    const deadline =
      Date.now() +
      Math.min(3600, Math.max(5, Number(options.timeout) || 300)) * 1000;
    while (["queued", "sending", "verifying"].includes(op.state)) {
      if (Date.now() >= deadline)
        fail(
          `Operation ${op.operationId}: ${op.state}. Timed out; the command has not been canceled. Check whether the gateway is paused. Do not change the key when retrying.`,
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        op = operation(
          this,
          await request(
            this,
            "GET",
            "/v1/operations/" + encodeURIComponent(op.operationId),
          ),
          op.operationId,
        );
      } catch {
        fail(
          `Operation ${op.operationId}: status could not be verified. The command has not been canceled. Retry only with the same event ID and action key.`,
        );
      }
    }
    if (op.state !== "succeeded") {
      const reason =
        typeof op.reason === "string" &&
        /^[a-z][a-z0-9_]{0,100}$/.test(op.reason)
          ? op.reason
          : "unknown";
      const codes = ["status", "check"].flatMap((k) => {
        const v = op.tiktokRejection?.[k as "status" | "check"];
        return Number.isSafeInteger(v) && Number(v) >= 0 ? [`${k}=${v}`] : [];
      });
      fail(
        `Operation ${op.operationId}: ${op.state} (${reason}${codes.length ? "; TikTok " + codes.join(", ") : ""}). Do not retry sending with a new key.`,
      );
    }
    out.push({
      ...input[i],
      json: {
        ...input[i].json,
        userId: recipient,
        eventId,
        operationId: op.operationId,
        state: op.state,
        ...(typeof op.messageId === "string"
          ? { messageId: op.messageId }
          : {}),
      },
      pairedItem: { item: i },
    });
  }
  return [out];
}
export async function getStickers(this: ILoadOptionsFunctions) {
  const data = (await request(this, "GET", "/v1/stickers")) as {
    stickers?: { id: string }[];
  };
  if (
    !Array.isArray(data?.stickers) ||
    data.stickers.some(
      (s) => typeof s?.id !== "string" || !/^[1-9]\d*$/.test(s.id),
    )
  )
    throw new NodeOperationError(
      this.getNode(),
      "Invalid gateway sticker catalog.",
    );
  return data.stickers.map((s) => ({ name: `Sticker ${s.id}`, value: s.id }));
}

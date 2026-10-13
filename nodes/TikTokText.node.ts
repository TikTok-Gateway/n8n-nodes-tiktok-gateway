import type {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  IWebhookFunctions,
  ILoadOptionsFunctions,
} from "n8n-workflow";
import * as shared from "./shared";
export class TikTokText implements INodeType {
  description: INodeTypeDescription = {
    displayName: "TikTok: Send Text",
    name: "tikTokText",
    group: ["output"],
    version: 1,
    icon: "file:tiktok.svg",
    description: "Send a text message and wait for confirmation",
    defaults: { name: "Send Text" },
    inputs: ["main"],
    outputs: ["main"],
    credentials: shared.credentials,
    properties: [
      ...shared.common,
      {
        displayName: "Text",
        name: "text",
        type: "string",
        typeOptions: { rows: 4 },
        default: "",
        required: true,
      },
      shared.advanced,
    ],
  };
  async execute(this: IExecuteFunctions) {
    return shared.execute.call(this, "text");
  }
}

import type {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  IWebhookFunctions,
  ILoadOptionsFunctions,
} from "n8n-workflow";
import * as shared from "./shared";
export class TikTokSticker implements INodeType {
  description: INodeTypeDescription = {
    displayName: "TikTok: Send Sticker",
    name: "tikTokSticker",
    group: ["output"],
    version: 1,
    icon: "file:tiktok.png",
    description: "Choose a sticker from the catalog and wait for confirmation",
    defaults: { name: "Send Sticker" },
    inputs: ["main"],
    outputs: ["main"],
    credentials: shared.credentials,
    properties: [
      ...shared.common,
      {
        displayName: "Sticker",
        name: "stickerId",
        type: "options",
        typeOptions: { loadOptionsMethod: "getStickers" },
        default: "",
        required: true,
        description: "Saved stickers from the gateway catalogue",
      },
      shared.advanced,
    ],
  };
  methods = { loadOptions: { getStickers: shared.getStickers } };
  async execute(this: IExecuteFunctions) {
    return shared.execute.call(this, "sticker");
  }
}

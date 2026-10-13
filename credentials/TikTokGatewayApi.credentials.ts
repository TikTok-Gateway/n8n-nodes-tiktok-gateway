import type {
  ICredentialType,
  INodeProperties,
  IAuthenticateGeneric,
  ICredentialTestRequest,
} from "n8n-workflow";
export class TikTokGatewayApi implements ICredentialType {
  name = "tikTokGatewayApi";
  displayName = "TikTok Gateway";
  properties: INodeProperties[] = [
    {
      displayName: "Gateway URL",
      name: "url",
      type: "string",
      default: "http://tiktok-gateway:8080",
      required: true,
    },
    {
      displayName: "API Token",
      name: "apiToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
    },
    {
      displayName: "Webhook Token",
      name: "webhookToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: { Authorization: "=Bearer {{$credentials.apiToken}}" },
    },
  };
  test: ICredentialTestRequest = {
    request: { baseURL: "={{$credentials.url}}", url: "/v1/status" },
  };
}

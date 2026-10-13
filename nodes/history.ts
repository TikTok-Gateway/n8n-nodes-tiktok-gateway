import type { IDataObject } from "n8n-workflow";
export const numericID = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[1-9]\d{0,19}$/.test(v) &&
  BigInt(v) <= 18446744073709551615n;
export const validTime = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  Number.isFinite(Date.parse(v));
export interface HistoryMessage extends IDataObject {
  messageId: string;
  senderId: string;
  direction: string;
  type: string;
  text: string;
  sentAt: string;
  replyToMessageId?: string;
}
export interface History extends IDataObject {
  accountId: string;
  userId: string;
  conversationId: string;
  messages: HistoryMessage[];
  complete: boolean;
  hasGaps: boolean;
  nextCursor: string;
}
export function validMessage(
  value: unknown,
  account: unknown,
  user: unknown,
): value is HistoryMessage {
  const m = value as HistoryMessage | null;
  return (
    !!m &&
    numericID(m.messageId) &&
    numericID(m.senderId) &&
    (m.senderId === account || m.senderId === user) &&
    m.direction === (m.senderId === account ? "outgoing" : "incoming") &&
    ["text", "image", "video", "sticker", "unknown"].includes(m.type) &&
    typeof m.text === "string" &&
    validTime(m.sentAt) &&
    (m.replyToMessageId === undefined || numericID(m.replyToMessageId))
  );
}

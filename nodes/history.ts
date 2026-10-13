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
// Deliberately conservative. This authorizes classification, never a send.
export function firstWelcomeReply(
  history: History,
  event: IDataObject,
  welcome: string,
  allowSticker: boolean,
): boolean {
  if (
    !welcome.trim() ||
    !history.complete ||
    history.hasGaps ||
    event.type !== "message.received" ||
    event.accountId !== history.accountId ||
    event.userId !== history.userId ||
    event.conversationId !== history.conversationId ||
    !validMessage(event.message, history.accountId, history.userId)
  )
    return false;
  const rows = history.messages;
  if (rows.length !== 2 && !(allowSticker && rows.length === 3)) return false;
  const first = rows[0],
    last = rows[rows.length - 1];
  if (
    first.direction !== "outgoing" ||
    first.type !== "text" ||
    first.text !== welcome ||
    first.replyToMessageId
  )
    return false;
  if (
    rows.length === 3 &&
    (rows[1].direction !== "outgoing" ||
      rows[1].type !== "sticker" ||
      rows[1].replyToMessageId ||
      Date.parse(rows[1].sentAt) <= Date.parse(first.sentAt) ||
      Date.parse(rows[1].sentAt) >= Date.parse(last.sentAt))
  )
    return false;
  return (
    last.direction === "incoming" &&
    last.type === "text" &&
    !!last.text.trim() &&
    last.messageId === event.messageId &&
    last.messageId === event.message.messageId &&
    last.text === event.message.text &&
    last.sentAt === event.message.sentAt &&
    Date.parse(last.sentAt) > Date.parse(first.sentAt) &&
    (!last.replyToMessageId || last.replyToMessageId === first.messageId)
  );
}

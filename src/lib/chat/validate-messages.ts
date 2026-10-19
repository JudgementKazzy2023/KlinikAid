/**
 * Server-side bounds for the patient chat request (#73 item 10).
 *
 * The input box caps a message at 1000 characters, but the route accepted any
 * body, so a direct request could send arbitrarily long text -- and a long
 * history -- to the model. The client-supplied history is bounded too, since it
 * is forwarded to the model as context.
 */

export const CHAT_MESSAGE_MAX = 1000;
/** Earlier turns are cut to this length before they are forwarded as context. */
export const CHAT_HISTORY_ENTRY_MAX = 8000;
/** Older turns beyond this are dropped, not refused. */
export const CHAT_HISTORY_MAX_ENTRIES = 40;

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export type ChatMessagesCheck =
  | { valid: true; messages: ChatMessage[]; userQuery: string }
  | { valid: false; error: string };

export function validateChatMessages(messages: unknown): ChatMessagesCheck {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { valid: false, error: "Messages history is required." };
  }

  // A long conversation is legitimate; only the most recent turns are forwarded.
  const recent = messages.slice(-CHAT_HISTORY_MAX_ENTRIES);
  const checked: ChatMessage[] = [];
  for (const entry of recent) {
    if (!entry || typeof entry !== "object") {
      return { valid: false, error: "Each message must have a role and text content." };
    }
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "model") || typeof content !== "string") {
      return { valid: false, error: "Each message must have a role and text content." };
    }
    checked.push({ role, content });
  }

  const last = checked[checked.length - 1];
  if (last.role !== "user" || !last.content.trim()) {
    return { valid: false, error: "The last message must be a user message with content." };
  }
  // The new message is checked as sent, not after trimming.
  if (last.content.length > CHAT_MESSAGE_MAX) {
    return { valid: false, error: `Messages must be ${CHAT_MESSAGE_MAX} characters or fewer.` };
  }
  const userQuery = last.content.trim();

  // A long earlier reply (the client stores model replies whole) must not block
  // the next question: earlier turns are shortened, not refused.
  for (let i = 0; i < checked.length - 1; i++) {
    if (checked[i].content.length > CHAT_HISTORY_ENTRY_MAX) {
      checked[i] = { ...checked[i], content: checked[i].content.slice(0, CHAT_HISTORY_ENTRY_MAX) };
    }
  }

  return { valid: true, messages: checked, userQuery };
}

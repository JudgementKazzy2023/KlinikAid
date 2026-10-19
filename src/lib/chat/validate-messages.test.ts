import { describe, expect, it } from "vitest";
import {
  CHAT_HISTORY_ENTRY_MAX,
  CHAT_HISTORY_MAX_ENTRIES,
  CHAT_MESSAGE_MAX,
  validateChatMessages,
} from "./validate-messages";

const user = (content: string) => ({ role: "user", content });
const model = (content: string) => ({ role: "model", content });

describe("validateChatMessages", () => {
  it("accepts a normal conversation and returns the trimmed last user message", () => {
    const result = validateChatMessages([model("Hello"), user("  What are your hours?  ")]);
    expect(result).toEqual({
      valid: true,
      messages: [
        { role: "model", content: "Hello" },
        { role: "user", content: "  What are your hours?  " },
      ],
      userQuery: "What are your hours?",
    });
  });

  it("accepts a message at the limit and refuses one over it", () => {
    expect(validateChatMessages([user("a".repeat(CHAT_MESSAGE_MAX))]).valid).toBe(true);
    expect(validateChatMessages([user("a".repeat(CHAT_MESSAGE_MAX + 1))])).toEqual({
      valid: false,
      error: `Messages must be ${CHAT_MESSAGE_MAX} characters or fewer.`,
    });
    expect(validateChatMessages([user("a".repeat(5000))]).valid).toBe(false);
  });

  it("bounds the forwarded history: keeps only the most recent turns", () => {
    const long = Array.from({ length: CHAT_HISTORY_MAX_ENTRIES + 5 }, (_, i) => (i % 2 ? model(`m${i}`) : user(`u${i}`)));
    const result = validateChatMessages(long);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("unreachable");
    expect(result.messages).toHaveLength(CHAT_HISTORY_MAX_ENTRIES);
    expect(result.messages[0].content).toBe("m5");
    expect(result.userQuery).toBe(`u${CHAT_HISTORY_MAX_ENTRIES + 4}`);
    expect(validateChatMessages([model("x".repeat(CHAT_HISTORY_ENTRY_MAX + 1)), user("hi")]).valid).toBe(false);
  });

  it.each([
    [undefined],
    [[]],
    ["text"],
    [[{ role: "user", content: 42 }]],
    [[{ role: "system", content: "hi" }]],
    [[null]],
    [[user("   ")]],
    [[user("hi"), model("hello")]],
  ])("refuses malformed input %j without throwing", (messages) => {
    expect(validateChatMessages(messages).valid).toBe(false);
  });
});

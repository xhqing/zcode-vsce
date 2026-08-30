import { describe, expect, test } from "bun:test";
import { estimateTokens, formatTokenCount } from "../webview/tokens.ts";

describe("token estimate", () => {
  test("latin text counts ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("The user asked a question")).toBe(7);
  });

  test("CJK chars count one token each", () => {
    expect(estimateTokens("你好")).toBe(2);
    expect(estimateTokens("用户问了一个问题")).toBe(8);
  });

  test("mixed CJK and latin", () => {
    // 4 CJK chars (4 tokens) + "abcd e f" = 8 other chars (2 tokens)
    expect(estimateTokens("你好世界abcd e f")).toBe(6);
  });

  test("empty text is zero", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("four-digit counts get thousands separators", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1000)).toBe("1,000");
    expect(formatTokenCount(12345)).toBe("12,345");
    expect(formatTokenCount(1234567)).toBe("1,234,567");
  });
});

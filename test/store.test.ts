import { describe, expect, test } from "bun:test";
import { Store } from "../webview/store.ts";
import { normalizeEvent, restoredMessages } from "../src/reuse/events.ts";

describe("Store event projection", () => {
  test("streams text deltas into one assistant text block", () => {
    const store = new Store();
    store.applyEvent({ kind: "turn_started" });
    store.applyEvent({ kind: "text_delta", delta: "Hello", assistantMessageId: "m1" });
    store.applyEvent({ kind: "text_delta", delta: " world", assistantMessageId: "m1" });
    const entry = store.state.transcript.at(-1);
    expect(entry?.role).toBe("assistant");
    expect(entry?.blocks).toEqual([{ kind: "text", messageId: "m1", text: "Hello world" }]);
    expect(store.state.running).toBe(true);
  });

  test("reasoning and text form separate blocks", () => {
    const store = new Store();
    store.applyEvent({ kind: "reasoning_delta", delta: "thinking…" });
    store.applyEvent({ kind: "text_delta", delta: "answer" });
    const entry = store.state.transcript.at(-1);
    expect(entry?.blocks.map((block) => block.kind)).toEqual(["reasoning", "text"]);
  });

  test("tool lifecycle updates the same card", () => {
    const store = new Store();
    store.applyEvent({ kind: "tool_call_started", toolCallId: "tc1", toolName: "Bash" });
    store.applyEvent({ kind: "tool_call_result", toolCallId: "tc1", toolName: "Bash", result: "done" });
    const card = store.state.transcript.at(-1)?.blocks[0];
    expect(card).toMatchObject({ kind: "tool", toolCallId: "tc1", status: "completed" });
  });

  test("tool error marks the card failed", () => {
    const store = new Store();
    store.applyEvent({ kind: "tool_call_started", toolCallId: "tc2", toolName: "Edit" });
    store.applyEvent({ kind: "tool_call_error", toolCallId: "tc2", toolName: "Edit", error: { message: "nope" } });
    const card = store.state.transcript.at(-1)?.blocks[0];
    expect(card).toMatchObject({ kind: "tool", status: "failed" });
  });

  test("turn_complete stops the spinner and records tokens", () => {
    const store = new Store();
    store.applyEvent({ kind: "turn_started" });
    store.applyEvent({ kind: "turn_complete", tokenCount: 1234 });
    expect(store.state.running).toBe(false);
    expect(store.state.lastResponseTokens).toBe(1234);
  });

  test("turn_error surfaces an error block", () => {
    const store = new Store();
    store.applyEvent({ kind: "turn_error", error: { message: "boom" } });
    const block = store.state.transcript.at(-1)?.blocks[0];
    expect(block).toEqual({ kind: "error", message: "boom" });
  });
});

describe("normalizeEvent (reused from zcode-tui)", () => {
  test("unwraps envelope/payload nesting", () => {
    const event = normalizeEvent({
      params: {
        payload: {
          kind: "text_delta",
          delta: "hi",
          assistantMessageId: "m1"
        }
      }
    });
    expect(event?.delta).toBe("hi");
    expect(event?.messageId).toBe("m1");
  });

  test("maps tool_call kinds", () => {
    const event = normalizeEvent({ payload: { kind: "tool_call_started", toolName: "Read" } });
    expect(event?.kind).toBe("tool_call_started");
    expect(event?.toolName).toBe("Read");
  });
});

describe("restoredMessages", () => {
  test("projects snapshot messages into roles and parts", () => {
    const messages = restoredMessages([
      { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
      {
        info: { role: "assistant" },
        parts: [
          { type: "reasoning", text: "hmm" },
          { type: "tool", callId: "c1", tool: "Bash", state: { status: "completed", input: {}, output: "ok", title: "run", startedAt: 1, completedAt: 2 } }
        ]
      }
    ]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]!.parts[1]).toMatchObject({ type: "tool", toolName: "Bash" });
  });
});

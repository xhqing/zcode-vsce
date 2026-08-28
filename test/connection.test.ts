import { describe, expect, test } from "bun:test";
import { JsonRpcConnection, JsonRpcError } from "../src/runtime/connection.ts";

function harness() {
  const written: string[] = [];
  const connection = new JsonRpcConnection({ write: (line) => written.push(line) });
  return { connection, written };
}

describe("JsonRpcConnection", () => {
  test("round-trips requests by id", async () => {
    const { connection, written } = harness();
    const pending = connection.request("session/create", { a: 1 });
    await Promise.resolve();
    const sent = JSON.parse(written[0]!);
    expect(sent.method).toBe("session/create");
    expect(sent.params).toEqual({ a: 1 });
    connection.receive(`${JSON.stringify({ id: sent.id, result: { ok: true } })}\n`);
    expect(await pending).toEqual({ ok: true });
  });

  test("rejects with JsonRpcError on error envelope", async () => {
    const { connection, written } = harness();
    const pending = connection.request("session/send", {});
    await Promise.resolve();
    const sent = JSON.parse(written[0]!);
    connection.receive(`${JSON.stringify({ id: sent.id, error: { code: -32010, message: "busy" } })}\n`);
    try {
      await pending;
      throw new Error("should have rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonRpcError);
      expect((error as JsonRpcError).code).toBe(-32010);
    }
  });

  test("emits notifications without id", () => {
    const { connection } = harness();
    const notifications: Array<[string, unknown]> = [];
    connection.on("notification", (method, params) => notifications.push([method, params]));
    connection.receive(`${JSON.stringify({ method: "session/event", params: { seq: 3 } })}\n`);
    expect(notifications).toEqual([["session/event", { seq: 3 }]]);
  });

  test("dispatches server requests through the handler and writes the reply", async () => {
    const { connection, written } = harness();
    connection.onServerRequest((method, params) => ({ answered: method, params }));
    connection.receive(`${JSON.stringify({ id: 7, method: "interaction/requestPermission", params: { x: 1 } })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reply = JSON.parse(written[0]!);
    expect(reply).toEqual({ id: 7, result: { answered: "interaction/requestPermission", params: { x: 1 } } });
  });

  test("splits chunked input across lines", () => {
    const { connection } = harness();
    const notifications: Array<[string, unknown]> = [];
    connection.on("notification", (method) => notifications.push(method));
    connection.receive('{"method":"a","pa');
    connection.receive('rams":{}}\n{"method":"b"}\n');
    expect(notifications.map(([method]) => method)).toEqual(["a", "b"]);
  });

  test("ignores non-protocol stdout lines", () => {
    const { connection } = harness();
    let fired = 0;
    connection.on("notification", () => { fired += 1; });
    connection.receive("ZCode 0.16.3\nnot json at all\n");
    expect(fired).toBe(0);
    expect(connection).toBeDefined();
  });

  test("close rejects pending requests", async () => {
    const { connection } = harness();
    const pending = connection.request("session/usage", {});
    await Promise.resolve();
    connection.close();
    try {
      await pending;
      throw new Error("should have rejected");
    } catch (error) {
      expect((error as Error).message).toContain("closed");
    }
  });
});

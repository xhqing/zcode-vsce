/**
 * JSON-RPC duplex connection to the ZCode app-server stdio protocol.
 *
 * Line-delimited JSON on the child's stdin/stdout. Client requests carry an
 * `id`; the server responds with the same `id`. Server-initiated requests
 * (interaction/*, session/requestRuntimePreferences) carry both `id` and
 * `method` and must be answered by writing `{id, result}` back. Plain
 * notifications (`session/event`, `state.updated`, telemetry) have `method`
 * without `id`.
 */

import { EventEmitter } from "node:events";

export interface JsonRpcConnectionOptions {
  /** Milliseconds before a client request rejects with a timeout. */
  requestTimeoutMs?: number;
  write(line: string): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class JsonRpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown> | unknown;

export class JsonRpcConnection extends EventEmitter {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly writeLine: (line: string) => void;
  private serverRequestHandler: ServerRequestHandler | undefined;
  private buffer = "";
  private closed = false;

  constructor(options: JsonRpcConnectionOptions) {
    super();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.writeLine = options.write;
  }

  /** Register the handler for server-initiated requests (id + method). */
  onServerRequest(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  /** Feed one chunk of stdout; splits on newlines and dispatches messages. */
  receive(chunk: string | Buffer): void {
    if (this.closed) return;
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf("\n");
    }
    // Guard against a peer flooding us without newlines.
    if (this.buffer.length > 64 * 1024 * 1024) {
      this.buffer = "";
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return; // Non-protocol stdout (banners, warnings) — ignore.
    }

    if (typeof message.method === "string") {
      if (message.id !== undefined && message.id !== null) {
        void this.dispatchServerRequest(message);
      } else {
        this.emit("notification", message.method, message.params);
      }
      return;
    }

    const id = typeof message.id === "number" ? message.id : undefined;
    if (id === undefined) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      const error = message.error as { message?: string; code?: number; data?: unknown };
      pending.reject(new JsonRpcError(
        error.message?.trim() || "app-server request failed",
        error.code,
        error.data
      ));
    } else {
      pending.resolve(message.result);
    }
  }

  private async dispatchServerRequest(message: Record<string, unknown>): Promise<void> {
    const id = message.id as number | string;
    const method = message.method as string;
    try {
      const result = await this.serverRequestHandler?.(method, message.params) ?? {};
      this.writeLine(JSON.stringify({ id, result }) + "\n");
    } catch (error) {
      this.writeLine(JSON.stringify({
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error)
        }
      }) + "\n");
    }
  }

  /** Issue a client request and await the matching response. */
  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error("connection closed"));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JsonRpcError(`app-server request timed out: ${method}`, -32001));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.writeLine(JSON.stringify({ id, method, params: params ?? {} }) + "\n");
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Respond to a server request that was deferred (e.g. awaiting user input). */
  respond(id: number | string, result: unknown): void {
    this.writeLine(JSON.stringify({ id, result }) + "\n");
  }

  respondError(id: number | string, message: string): void {
    this.writeLine(JSON.stringify({ id, error: { code: -32000, message } }) + "\n");
  }

  /** Reject every in-flight request; called when the child exits. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("app-server connection closed"));
    }
    this.pending.clear();
  }
}

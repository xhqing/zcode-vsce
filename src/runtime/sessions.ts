/**
 * SessionManager: multi-session lifecycle over one app-server connection.
 *
 * One extension instance owns one runtime process; every chat tab works on a
 * session addressed by sessionId through session/* methods.
 */

import { EventEmitter } from "node:events";
import type { JsonRpcConnection, JsonRpcError } from "./connection.ts";
import {
  defaultRuntimePreferences,
  type AttachmentRef,
  type DeliveryKind,
  type PermissionResponse,
  type SessionBootstrap,
  type SessionEventEnvelope,
  type SessionInfo,
  type SessionSettings,
  type WorkspaceRef
} from "./protocol.ts";

const deliveryKind: DeliveryKind = "desktop-continuous";
/** Runtime error code for "session deactivated / not resident yet". */
const sessionUnavailableCode = -32004;

function isSessionUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as JsonRpcError).code === sessionUnavailableCode;
}

async function withSessionRetry<T>(operation: () => Promise<T>, attempts = 5, delayMs = 120): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSessionUnavailable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

export class SessionManager extends EventEmitter {
  private readonly sessions = new Map<string, SessionBootstrap["session"]>();
  private settingsBySession = new Map<string, SessionSettings>();
  private lastEventSeq = new Map<string, number>();

  constructor(private readonly connection: JsonRpcConnection) {
    super();
    connection.onServerRequest(async (method, params) => {
      const record = (params ?? {}) as Record<string, unknown>;
      if (method === "session/requestRuntimePreferences") {
        return defaultRuntimePreferences;
      }
      this.emit("serverRequest", method, record);
      return {};
    });
    connection.on("notification", (method: string, params: unknown) => {
      const record = (params ?? {}) as Record<string, unknown>;
      if (method === "session/event") {
        const envelope = record as unknown as SessionEventEnvelope;
        const seq = typeof envelope.seq === "number" ? envelope.seq : undefined;
        if (seq !== undefined) this.lastEventSeq.set(envelope.sessionId, seq);
        this.emit("event", envelope);
      } else if (method === "state.updated" || method === "message/global") {
        this.emit(method, record);
      }
      // v4/telemetry/* and unknown notifications are dropped here.
    });
  }

  private workspaceRef(path: string): WorkspaceRef {
    // workspaceKey doubles as the persistence key; the runtime's own session
    // list later rewrites it to the workspace path, so use the path itself.
    return { workspacePath: path, workspaceKey: path };
  }

  async createSession(workspacePath: string, options: { mode?: string; titleGenerationEnabled?: boolean } = {}): Promise<SessionBootstrap> {
    const result = await this.connection.request("session/create", {
      workspace: this.workspaceRef(workspacePath),
      titleGenerationEnabled: options.titleGenerationEnabled ?? true,
      ...(options.mode ? { mode: options.mode } : {})
    }) as SessionBootstrap;
    this.track(result);
    // The resident pool may answer "not active" for a beat after create;
    // retry briefly before surfacing an error.
    await withSessionRetry(() => this.subscribe(result.session.sessionId));
    return result;
  }

  async resumeSession(sessionId: string, workspacePath?: string): Promise<SessionBootstrap> {
    const result = await withSessionRetry(() => this.connection.request("session/resume", {
      sessionId,
      ...(workspacePath ? { workspace: this.workspaceRef(workspacePath) } : {})
    }) as Promise<SessionBootstrap>);
    this.track(result);
    // Re-subscribe; when we already have a seq cursor, resume replays missed
    // events so a reconnected chat tab catches up.
    const afterSeq = this.lastEventSeq.get(sessionId);
    const replay = await withSessionRetry(() => this.connection.request("session/subscribe", {
      sessionId,
      deliveryKind,
      ...(afterSeq !== undefined ? { afterSeq } : {})
    }) as Promise<{ events?: SessionEventEnvelope[]; eventSeq: number }>);
    for (const event of replay.events ?? []) this.emit("event", event);
    return result;
  }

  async subscribe(sessionId: string, includeSnapshot = false): Promise<{ eventSeq: number; snapshot?: unknown }> {
    return await this.connection.request("session/subscribe", {
      sessionId,
      deliveryKind,
      includeSnapshot
    }) as { eventSeq: number; snapshot?: unknown };
  }

  async send(sessionId: string, content: string, attachments?: AttachmentRef[]): Promise<unknown> {
    return await withSessionRetry(() => this.connection.request("session/send", {
      sessionId,
      content,
      ...(attachments && attachments.length > 0 ? { attachments } : {})
    }));
  }

  async stop(sessionId: string): Promise<unknown> {
    return await this.connection.request("session/stop", { sessionId });
  }

  async compact(sessionId: string, instructions?: string): Promise<unknown> {
    return await this.connection.request("session/compact", {
      sessionId,
      ...(instructions ? { instructions } : {})
    });
  }

  async fork(sessionId: string): Promise<unknown> {
    return await this.connection.request("session/fork", { sessionId });
  }

  async close(sessionId: string): Promise<unknown> {
    const result = await this.connection.request("session/close", { sessionId });
    this.sessions.delete(sessionId);
    this.settingsBySession.delete(sessionId);
    this.lastEventSeq.delete(sessionId);
    return result;
  }

  async list(workspacePath?: string): Promise<SessionInfo[]> {
    const result = await this.connection.request("session/list", {
      ...(workspacePath ? { workspace: this.workspaceRef(workspacePath) } : {})
    }) as { sessions?: SessionInfo[] };
    return result.sessions ?? [];
  }

  async readMessages(sessionId: string): Promise<unknown> {
    return await withSessionRetry(() => this.connection.request("session/messages", { sessionId }));
  }

  async setModel(sessionId: string, model: { providerId: string; modelId: string }): Promise<unknown> {
    const result = await withSessionRetry(() => this.connection.request("session/setModel", {
      sessionId,
      model,
      persistAsWorkspaceLastUsed: false
    }));
    await this.refreshSettings(sessionId);
    return result;
  }

  async setMode(sessionId: string, mode: string): Promise<unknown> {
    const result = await withSessionRetry(() => this.connection.request("session/setMode", { sessionId, mode }));
    await this.refreshSettings(sessionId);
    return result;
  }

  async setThoughtLevel(sessionId: string, thoughtLevel: string): Promise<unknown> {
    const result = await withSessionRetry(() => this.connection.request("session/setThoughtLevel", {
      sessionId,
      thoughtLevel,
      persistAsWorkspaceLastUsed: false
    }));
    await this.refreshSettings(sessionId);
    return result;
  }

  async usage(sessionId: string): Promise<unknown> {
    return await withSessionRetry(() => this.connection.request("session/usage", { sessionId }));
  }

  settings(sessionId: string): SessionSettings | undefined {
    return this.settingsBySession.get(sessionId);
  }

  session(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  private async refreshSettings(sessionId: string): Promise<void> {
    try {
      const result = await withSessionRetry(() => this.connection.request("session/read", { sessionId }) as Promise<
        { settings?: SessionSettings }
      >);
      if (result?.settings) this.settingsBySession.set(sessionId, result.settings);
    } catch {
      // Session may have just closed; stale settings are harmless.
    }
  }

  /** Respond to a pending interaction/requestPermission. */
  respondPermission(rawRequestId: unknown, response: PermissionResponse): void {
    this.connection.respond(rawRequestId as number | string, response);
  }

  respondUserInput(rawRequestId: unknown, value: { value?: unknown; cancelled?: boolean }): void {
    this.connection.respond(rawRequestId as number | string, value);
  }

  private track(bootstrap: SessionBootstrap): void {
    if (bootstrap.session) this.sessions.set(bootstrap.session.sessionId, bootstrap.session);
    if (bootstrap.settings && bootstrap.session) {
      this.settingsBySession.set(bootstrap.session.sessionId, bootstrap.settings);
    }
  }
}

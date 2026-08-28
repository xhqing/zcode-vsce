/**
 * ZcodeController: the extension-host side hub.
 *
 * Owns the RuntimeHost (one app-server process per window), the
 * SessionManager, the .env → config.json sync + key-failover proxy bootstrap
 * (both reused from zcode-cli), and message routing to the webview.
 */

import * as vscode from "vscode";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { RuntimeHost } from "./runtime/host.ts";
import { SessionManager } from "./runtime/sessions.ts";
import type { PermissionRequest, SessionEventEnvelope, UserInputRequest } from "./runtime/protocol.ts";
import { normalizeEvent, restoredMessages } from "./reuse/events.ts";
import { readEnvFile, resolveUpstreamBaseURL, syncEnvFileToConfig } from "./reuse/env-config.ts";
import { collectApiKeys, startKeyFailoverProxy, type KeyFailoverProxy } from "./reuse/key-failover.ts";
import { ensureUserConfig } from "./reuse/model-access.ts";

export type PanelMessage =
  | { t: "ready" }
  | { t: "bootstrap"; sessionId?: string; snapshot?: unknown; settings?: unknown; sessions?: unknown[] }
  | { t: "event"; sessionId: string; event: unknown }
  | { t: "permission"; request: PermissionRequest }
  | { t: "userInput"; request: UserInputRequest }
  | { t: "runtimeExit"; message: string }
  | { t: "notice"; level: "info" | "error"; message: string };

export class ZcodeController implements vscode.Disposable {
  readonly host = new RuntimeHost();
  private sessions: SessionManager | undefined;
  private failoverProxy: KeyFailoverProxy | undefined;
  private readonly messageListeners = new Set<(message: PanelMessage) => void>();
  private readonly statusListeners = new Set<(status: ControllerStatus) => void>();
  private idleTimer: NodeJS.Timeout | undefined;
  private restartBackoffMs = 500;
  private disposed = false;
  private activeSessionId: string | undefined;
  private pendingPermissionRequests = new Map<string, { rawId: unknown; request: PermissionRequest }>();
  private pendingUserInputRequests = new Map<string, { rawId: unknown; request: UserInputRequest }>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  get sessionManager(): SessionManager | undefined {
    return this.sessions;
  }

  get activeSession(): string | undefined {
    return this.activeSessionId;
  }

  onPanelMessage(listener: (message: PanelMessage) => void): vscode.Disposable {
    this.messageListeners.add(listener);
    return new vscode.Disposable(() => this.messageListeners.delete(listener));
  }

  onStatus(listener: (status: ControllerStatus) => void): vscode.Disposable {
    this.statusListeners.add(listener);
    return new vscode.Disposable(() => this.statusListeners.delete(listener));
  }

  private emit(message: PanelMessage): void {
    for (const listener of [...this.messageListeners]) {
      try {
        listener(message);
      } catch {
        // A dead panel listener must not break the runtime pipeline.
      }
    }
  }

  private emitStatus(): void {
    const status: ControllerStatus = {
      running: this.host.running,
      sessionActive: this.activeSessionId !== undefined
    };
    for (const listener of this.statusListeners) listener(status);
  }

  runtimePath(): string {
    return join(this.context.extensionPath, "vendor", "zcode.cjs");
  }

  nodeExecutable(): string {
    const configured = vscode.workspace.getConfiguration("zcode").get<string>("nodeExecutable")?.trim();
    if (configured) return configured;
    const fromEnv = process.env.ZCODE_NODE?.trim();
    if (fromEnv) return fromEnv;
    return "node"; // Resolved via PATH by the system spawner.
  }

  /**
   * Ensure the runtime is up: run the .env sync (failover proxy included),
   * spawn app-server, wire the session manager. Idempotent.
   */
  async ensureRuntime(): Promise<SessionManager> {
    if (this.sessions && this.host.running) return this.sessions;

    if (!existsSync(this.runtimePath())) {
      throw new Error(
        "ZCode runtime is missing from the extension (vendor/zcode.cjs). "
        + "This is a packaging defect; reinstall the extension."
      );
    }

    await this.bootstrapConfig();

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const connection = this.host.start({
      nodeExecutable: this.nodeExecutable(),
      runtimePath: this.runtimePath(),
      cwd: workspacePath,
      env: process.env
    });

    const manager = new SessionManager(connection);
    manager.on("serverRequest", (method: string, params: Record<string, unknown>) => {
      this.handleServerRequest(method, params);
    });
    manager.on("event", (envelope: SessionEventEnvelope) => {
      this.emit({ t: "event", sessionId: envelope.sessionId, event: envelope.payload });
    });
    this.sessions = manager;
    this.emitStatus();

    this.host.removeAllListeners("exit");
    this.host.on("exit", (error: Error, intentional: boolean) => {
      this.sessions = undefined;
      this.emitStatus();
      if (intentional || this.disposed) return;
      this.emit({ t: "runtimeExit", message: error.message });
      this.scheduleRestart();
    });
    return manager;
  }

  private scheduleRestart(): void {
    if (this.disposed) return;
    const delay = this.restartBackoffMs;
    this.restartBackoffMs = Math.min(this.restartBackoffMs * 2, 30_000);
    setTimeout(() => {
      if (this.disposed || this.host.running) return;
      this.ensureRuntime().then(() => {
        this.restartBackoffMs = 500;
        this.emit({ t: "notice", level: "info", message: "ZCode runtime restarted." });
      }).catch(() => {
        this.scheduleRestart();
      });
    }, delay).unref?.();
  }

  /** .env → config.json sync plus multi-key failover proxy, zcode-cli style. */
  private async bootstrapConfig(): Promise<void> {
    try {
      await ensureUserConfig();
      const envFile = await readEnvFile();
      const apiKeys = collectApiKeys(envFile?.values ?? {});
      const upstreamBaseURL = envFile ? resolveUpstreamBaseURL(envFile.values) : undefined;
      if (envFile && apiKeys.length > 1 && upstreamBaseURL && !this.failoverProxy) {
        this.failoverProxy = await startKeyFailoverProxy({ upstreamBaseURL, keys: apiKeys });
      }
      const sync = await syncEnvFileToConfig(undefined, {
        ...(this.failoverProxy ? { failoverProxyBaseURL: this.failoverProxy.baseURL } : {})
      });
      if (sync.error) {
        this.emit({ t: "notice", level: "error", message: `Invalid ${sync.envPath}: ${sync.error}` });
      }
    } catch (error) {
      this.emit({
        t: "notice",
        level: "error",
        message: `ZCode config bootstrap failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  private handleServerRequest(method: string, params: Record<string, unknown>): void {
    if (method === "interaction/requestPermission") {
      const request = params as unknown as PermissionRequest;
      if (!request.requestId) {
        request.requestId = `perm_${randomUUID()}`;
      }
      this.pendingPermissionRequests.set(request.requestId, { rawId: params.__rpcId ?? request.requestId, request });
      this.emit({ t: "permission", request });
      return;
    }
    if (method === "interaction/requestUserInput") {
      const request = params as unknown as UserInputRequest;
      this.pendingUserInputRequests.set(request.requestId, { rawId: params.__rpcId ?? request.requestId, request });
      this.emit({ t: "userInput", request });
      return;
    }
    // interaction/browserList, provider headers, …: answer empty for now.
  }

  /** Raw RPC ids are attached by the connection layer before dispatch. */
  attachRpcId(requestId: string, rawId: unknown): void {
    const entry = this.pendingPermissionRequests.get(requestId) ?? this.pendingUserInputRequests.get(requestId);
    if (entry) entry.rawId = rawId;
  }

  resolvePermission(requestId: string, optionId: string): void {
    const entry = this.pendingPermissionRequests.get(requestId);
    if (!entry) return;
    const option = entry.request.options.find((candidate) => candidate.optionId === optionId);
    if (!option) return;
    this.pendingPermissionRequests.delete(requestId);
    this.sessions?.respondPermission(entry.rawId, option.response);
  }

  resolveUserInput(requestId: string, value: { value?: unknown; cancelled?: boolean }): void {
    const entry = this.pendingUserInputRequests.get(requestId);
    if (!entry) return;
    this.pendingUserInputRequests.delete(requestId);
    this.sessions?.respondUserInput(entry.rawId, value);
  }

  setActiveSession(sessionId: string | undefined): void {
    this.activeSessionId = sessionId;
    this.emitStatus();
  }

  /** Stop the runtime after the configured idle period with no panel visible. */
  notifyPanelVisibility(visible: boolean): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (!visible) {
      const idleMs = vscode.workspace.getConfiguration("zcode").get<number>("idleShutdownMs") ?? 300_000;
      if (idleMs > 0 && this.host.running) {
        this.idleTimer = setTimeout(() => {
          void this.host.stop();
        }, idleMs);
        this.idleTimer.unref?.();
      }
    }
  }

  async newSession(): Promise<string | undefined> {
    const manager = await this.ensureRuntime();
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const bootstrap = await manager.createSession(workspacePath);
    this.activeSessionId = bootstrap.session.sessionId;
    this.emitStatus();
    return bootstrap.session.sessionId;
  }

  async resume(sessionId: string): Promise<void> {
    const manager = await this.ensureRuntime();
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    await manager.resumeSession(sessionId, workspacePath);
    this.activeSessionId = sessionId;
    this.emitStatus();
  }

  /** Convenience: messages → user-visible transcript parts for the webview. */
  normalizeMessages(value: unknown): unknown {
    return restoredMessages(value);
  }

  dispose(): void {
    this.disposed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    void this.failoverProxy?.close().catch(() => {});
    void this.host.stop();
  }
}

export interface ControllerStatus {
  running: boolean;
  sessionActive: boolean;
}

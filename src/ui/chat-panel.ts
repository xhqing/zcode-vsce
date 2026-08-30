/**
 * Chat tabs: editor-area WebviewPanels, one per session — mirrors the Claude
 * Code extension layout (sidebar lists sessions, each conversation opens as
 * its own editor tab next to the code). "New Session" always spawns a fresh
 * tab no matter how many are open; events and permission prompts are routed
 * to the tab bound to their sessionId.
 */

import * as vscode from "vscode";
import type { ZcodeController, PanelMessage } from "../controller.ts";
import type { PermissionRequest } from "../runtime/protocol.ts";

interface WebviewToHost {
  t: string;
  [key: string]: unknown;
}

/** One open chat tab and the session it displays. */
interface ChatEntry {
  panel: vscode.WebviewPanel;
  sessionId: string | undefined;
}

const viewColumn = vscode.ViewColumn.Active;

export class ChatTab {
  private readonly entries = new Set<ChatEntry>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: ZcodeController
  ) {
    this.controller.onPanelMessage((message) => this.dispatch(message));
  }

  /** Always open a NEW chat tab ("New Session" behavior). */
  async openNew(sessionId?: string): Promise<void> {
    this.spawn(sessionId);
    this.controller.notifyPanelVisibility(true);
  }

  /** Focus the tab bound to the session; open a new tab when none is. */
  async open(sessionId?: string): Promise<void> {
    const existing = this.entryFor(sessionId);
    if (existing) {
      existing.panel.reveal();
    } else {
      this.spawn(sessionId);
    }
    this.controller.notifyPanelVisibility(true);
  }

  /** Push a fresh snapshot of the active session into the tab bound to it. */
  async sendBootstrap(): Promise<void> {
    const entry = this.entryFor(this.controller.activeSession);
    if (entry) await this.sendBootstrapTo(entry);
  }

  visible(): boolean {
    return this.entries.size > 0;
  }

  private spawn(sessionId?: string): ChatEntry {
    const panel = vscode.window.createWebviewPanel(
      "zcode.chatPanel",
      sessionId ? "ZCode" : "ZCode — New Session",
      { viewColumn, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "out")]
      }
    );
    const entry: ChatEntry = { panel, sessionId };
    this.entries.add(entry);
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage((message: WebviewToHost) => void this.onMessage(entry, message));
    panel.onDidDispose(() => {
      this.entries.delete(entry);
      this.controller.notifyPanelVisibility(this.visible());
    });
    // The focused tab decides what "the active session" is for palette
    // commands (setModel etc.) and the status bar.
    panel.onDidChangeViewState(() => {
      if (panel.active && entry.sessionId) this.controller.setActiveSession(entry.sessionId);
    });
    if (sessionId) void this.sendBootstrapTo(entry);
    return entry;
  }

  private entryFor(sessionId: string | undefined): ChatEntry | undefined {
    if (!sessionId) return undefined;
    for (const entry of this.entries) {
      if (entry.sessionId === sessionId) return entry;
    }
    return undefined;
  }

  /** Route controller broadcasts to the tabs that should see them. */
  private dispatch(message: PanelMessage): void {
    if (message.t === "event") {
      this.postTo(this.entryFor(message.sessionId), message);
      return;
    }
    if (message.t === "permission") {
      const entry = this.entryFor(message.request.sessionId);
      if (entry) {
        this.postTo(entry, message);
        return;
      }
      // No tab bound to that session (tab closed mid-request): broadcast so
      // the prompt still surfaces somewhere instead of dangling unanswered.
      for (const candidate of [...this.entries]) this.postTo(candidate, message);
      return;
    }
    // userInput carries no sessionId in the protocol; runtimeExit and notice
    // are global — broadcast to every open tab.
    for (const entry of [...this.entries]) this.postTo(entry, message);
  }

  private postTo(entry: ChatEntry | undefined, message: PanelMessage): void {
    void entry?.panel.webview.postMessage(message);
  }

  private async sendBootstrapTo(entry: ChatEntry): Promise<void> {
    const sessionId = entry.sessionId;
    const manager = this.controller.sessionManager;
    if (!sessionId || !manager) return;
    const messages = await manager.readMessages(sessionId).catch(() => undefined);
    entry.panel.webview.postMessage({
      t: "bootstrap",
      sessionId,
      snapshot: { messages, settings: manager.settings(sessionId) },
      settings: manager.settings(sessionId)
    });
  }

  private async onMessage(entry: ChatEntry, message: WebviewToHost): Promise<void> {
    const manager = this.controller.sessionManager;
    const sessionId = entry.sessionId;
    try {
      switch (message.t) {
        case "ready":
          this.postTo(entry, { t: "uiSettings", fontSize: this.controller.uiSettings.fontSize });
          await this.controller.ensureRuntime();
          if (!entry.sessionId) {
            // First open without a session: create one right away (CC-like).
            const id = await this.controller.newSession();
            if (id) {
              entry.sessionId = id;
              entry.panel.title = "ZCode";
              await this.sendBootstrapTo(entry);
            }
          }
          break;
        case "newSession": {
          // A new session always means a fresh tab, regardless of open tabs.
          const id = await this.controller.newSession();
          if (id) await this.openNew(id);
          break;
        }
        case "attach": {
          // Minimal "+" behavior: pick a workspace file and insert an @path
          // reference into the composer (real multimodal attachments land later).
          const files = await vscode.workspace.findFiles("**/*", "**/node_modules/**", 300);
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
          const picked = await vscode.window.showQuickPick(
            files
              .map((file) => ({
                label: root && file.fsPath.startsWith(root) ? file.fsPath.slice(root.length + 1) : file.fsPath
              }))
              .sort((a, b) => a.label.localeCompare(b.label))
              .slice(0, 300),
            { placeHolder: "Reference a file (inserts @path)" }
          );
          if (picked) this.postTo(entry, { t: "insert", text: `@${picked.label}` });
          break;
        }
        case "send":
          if (manager && sessionId) {
            await manager.send(sessionId, String(message.text ?? ""), message.attachments as never);
          }
          break;
        case "stop":
          if (manager && sessionId) await manager.stop(sessionId);
          break;
        case "compact":
          if (manager && sessionId) await manager.compact(sessionId);
          break;
        case "permission":
          this.controller.resolvePermission(String(message.requestId), String(message.optionId ?? ""));
          break;
        case "userInput":
          this.controller.resolveUserInput(String(message.requestId), message.value as { value?: unknown; cancelled?: boolean });
          break;
        case "setModel": {
          const model = message.model as { providerId: string; modelId: string } | undefined;
          if (manager && sessionId && model) {
            await manager.setModel(sessionId, model);
            this.postTo(entry, { t: "settingsChanged", settings: manager.settings(sessionId) });
          } else if (!model) {
            // No payload: open the palette-driven picker instead of calling
            // setModel with undefined (runtime rejects it with Invalid params).
            void vscode.commands.executeCommand("zcode.setModel");
          }
          break;
        }
        case "setMode":
          if (manager && sessionId) await manager.setMode(sessionId, String(message.mode));
          await this.sendBootstrapTo(entry);
          break;
        case "setThoughtLevel": {
          if (manager && sessionId) {
            await manager.setThoughtLevel(sessionId, String(message.thoughtLevel));
            // Settings (not messages) changed: push just the settings so the
            // composer chips update without touching the transcript.
            this.postTo(entry, { t: "settingsChanged", settings: manager.settings(sessionId) });
          }
          break;
        }
        default:
          break;
      }
    } catch (error) {
      this.postTo(entry, {
        t: "notice",
        level: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "webview", "main.js")
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "webview", "main.css")
    );
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>ZCode</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

export type { PermissionRequest };

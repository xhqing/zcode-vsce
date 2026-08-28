/**
 * Chat tab: editor-area WebviewPanel hosting one session's conversation —
 * mirrors the Claude Code extension layout (sidebar lists sessions, the chat
 * itself opens as an editor tab next to the code).
 */

import * as vscode from "vscode";
import type { ZcodeController, PanelMessage } from "../controller.ts";
import type { PermissionRequest } from "../runtime/protocol.ts";

interface WebviewToHost {
  t: string;
  [key: string]: unknown;
}

const viewColumn = vscode.ViewColumn.Active;

export class ChatTab {
  private panel: vscode.WebviewPanel | undefined;
  private sessionId: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: ZcodeController
  ) {}

  get activeSessionId(): string | undefined {
    return this.sessionId;
  }

  /** Open (or reuse) the chat tab and point it at a session. */
  async open(sessionId?: string): Promise<void> {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "zcode.chatPanel",
        sessionId ? "ZCode" : "ZCode — New Session",
        { viewColumn, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "out")]
        }
      );
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.webview.onDidReceiveMessage((message: WebviewToHost) => void this.onMessage(message));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.sessionId = undefined;
      });
      this.controller.onPanelMessage((message) => this.post(message));
    } else {
      this.panel.reveal();
    }

    if (sessionId && sessionId !== this.sessionId) {
      this.sessionId = sessionId;
      this.panel.title = "ZCode";
      await this.sendBootstrap();
    }
    this.controller.notifyPanelVisibility(true);
  }

  /** Push a fresh snapshot of the active session into the webview. */
  async sendBootstrap(): Promise<void> {
    const sessionId = this.sessionId;
    const manager = this.controller.sessionManager;
    if (!sessionId || !manager) return;
    const messages = await manager.readMessages(sessionId).catch(() => undefined);
    this.post({
      t: "bootstrap",
      sessionId,
      snapshot: { messages, settings: manager.settings(sessionId) },
      settings: manager.settings(sessionId)
    });
  }

  post(message: PanelMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  visible(): boolean {
    return this.panel !== undefined;
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    const manager = this.controller.sessionManager;
    const sessionId = this.sessionId;
    try {
      switch (message.t) {
        case "ready":
          await this.controller.ensureRuntime();
          if (!this.sessionId) {
            // First open without a session: create one right away (CC-like).
            const id = await this.controller.newSession();
            if (id) {
              this.sessionId = id;
              this.panel!.title = "ZCode";
              await this.sendBootstrap();
            }
          }
          break;
        case "newSession": {
          const id = await this.controller.newSession();
          if (id) {
            this.sessionId = id;
            await this.sendBootstrap();
          }
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
            await this.sendBootstrap();
          } else {
            // No payload: open the palette-driven picker instead of calling
            // setModel with undefined (runtime rejects it with Invalid params).
            void vscode.commands.executeCommand("zcode.setModel");
          }
          break;
        }
        case "setMode":
          if (manager && sessionId) await manager.setMode(sessionId, String(message.mode));
          await this.sendBootstrap();
          break;
        case "setThoughtLevel":
          if (manager && sessionId) await manager.setThoughtLevel(sessionId, String(message.thoughtLevel));
          await this.sendBootstrap();
          break;
        default:
          break;
      }
    } catch (error) {
      this.post({
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

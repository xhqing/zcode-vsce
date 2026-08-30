/**
 * Sessions sidebar webview view: hosts webview/sidebar.html (CC-style
 * launcher — New session button, search box, session list with rename /
 * delete actions). The webview is pure presentation; session data and
 * actions flow through postMessage, resolved here against the controller.
 */

import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZcodeController } from "../controller.ts";

interface SidebarMessage {
  t: string;
  sessionId?: string;
  title?: string;
  [key: string]: unknown;
}

interface SidebarRow {
  sessionId: string;
  title: string;
  updatedAt: number;
  status?: string;
  active?: boolean;
}

export class SidebarView {
  public static readonly viewId = "zcode.sessions";
  private view: vscode.WebviewView | undefined;
  private readonly displayNames = new Map<string, string>();
  private readonly hidden = new Set<string>();
  private readonly running = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: ZcodeController
  ) {
    for (const [id, title] of Object.entries(
      context.workspaceState.get<Record<string, string>>("zcode.sessionNames") ?? {}
    )) {
      this.displayNames.set(id, title);
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "out")]
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: SidebarMessage) => void this.onMessage(message));
    view.onDidDispose(() => {
      this.view = undefined;
    });
    void this.refresh();
  }

  /** Reload sessions from the runtime and push rows to the webview. */
  async refresh(): Promise<void> {
    const manager = this.controller.sessionManager;
    const active = this.controller.activeSession;
    let rows: SidebarRow[] = [];
    if (manager) {
      try {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const sessions = await manager.list(workspacePath);
        rows = sessions
          .filter((session) => session.sessionKind === "interactive" && !this.hidden.has(session.sessionId))
          .slice(0, 100)
          .map((session) => ({
            sessionId: session.sessionId,
            title: this.displayNames.get(session.sessionId) ?? session.title ?? "Untitled session",
            updatedAt: session.updatedAt,
            status: this.running.has(session.sessionId) ? "running" : session.status,
            active: session.sessionId === active
          }));
      } catch {
        // Runtime not up yet: show the empty state.
      }
    }
    this.view?.webview.postMessage({ t: "sessions", sessions: rows });
  }

  setRunning(sessionId: string, running: boolean): void {
    if (running) this.running.add(sessionId);
    else this.running.delete(sessionId);
  }

  /** Flip the in-webview settings card open/closed (driven by the view-title gear). */
  toggleSettings(): void {
    this.view?.webview.postMessage({ t: "toggleSettings" });
  }

  private async onMessage(message: SidebarMessage): Promise<void> {
    switch (message.t) {
      case "ready":
        this.view?.webview.postMessage({ t: "uiSettings", fontSize: this.controller.uiSettings.fontSize });
        await this.refresh();
        break;
      case "setFontSize":
        this.controller.setFontSize(Number(message.fontSize));
        this.view?.webview.postMessage({ t: "uiSettings", fontSize: this.controller.uiSettings.fontSize });
        break;
      case "newSession":
        await vscode.commands.executeCommand("zcode.newSession");
        await this.refresh();
        break;
      case "open":
        if (typeof message.sessionId === "string") {
          await vscode.commands.executeCommand("zcode.resumeSession", message.sessionId);
          await this.refresh();
        }
        break;
      case "requestRename":
        this.view?.webview.postMessage({ t: "renaming", sessionId: message.sessionId });
        break;
      case "rename": {
        const id = message.sessionId;
        const title = String(message.title ?? "").trim();
        if (typeof id === "string" && title) {
          this.displayNames.set(id, title);
          await this.context.workspaceState.update(
            "zcode.sessionNames",
            Object.fromEntries(this.displayNames)
          );
        }
        this.view?.webview.postMessage({ t: "renaming", sessionId: undefined });
        await this.refresh();
        break;
      }
      case "cancelRename":
        this.view?.webview.postMessage({ t: "renaming", sessionId: undefined });
        break;
      case "requestDelete": {
        const id = message.sessionId;
        if (typeof id !== "string") break;
        const pick = await vscode.window.showWarningMessage(
          "Delete this session? Its history stays on disk (under ~/.zcode) but it will no longer be listed.",
          { modal: true },
          "Delete"
        );
        if (pick === "Delete") {
          this.hidden.add(id);
          const manager = this.controller.sessionManager;
          if (manager) await manager.close(id).catch(() => undefined);
          if (this.controller.activeSession === id) {
            this.controller.setActiveSession(undefined);
          }
          await this.refresh();
        }
        break;
      }
      default:
        break;
    }
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "webview", "sidebar.js")
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "webview", "sidebar.css")
    );
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Sessions</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

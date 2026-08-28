/**
 * Sessions sidebar: the single ZCode view — "New Session" button on top plus
 * the resumable session list (CC-style: sidebar is only the launcher; chats
 * live in editor tabs).
 */

import * as vscode from "vscode";
import type { SessionInfo } from "../runtime/protocol.ts";
import type { ZcodeController } from "../controller.ts";

export class SessionsTree implements vscode.TreeDataProvider<SessionItem | NewSessionItem> {
  public static readonly viewId = "zcode.sessions";
  private readonly emitter = new vscode.EventEmitter<SessionItem | NewSessionItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly controller: ZcodeController) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(item: SessionItem | NewSessionItem): vscode.TreeItem {
    return item;
  }

  async getChildren(element?: SessionItem | NewSessionItem): Promise<Array<SessionItem | NewSessionItem>> {
    if (element) return [];
    const items: Array<SessionItem | NewSessionItem> = [new NewSessionItem()];
    const manager = this.controller.sessionManager;
    if (!manager) return items;
    try {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const sessions = await manager.list(workspacePath);
      const active = this.controller.activeSession;
      for (const session of sessions
        .filter((candidate) => candidate.sessionKind === "interactive")
        .slice(0, 50)) {
        items.push(new SessionItem(session, session.sessionId === active));
      }
    } catch {
      // Runtime not up yet: just show the New Session entry.
    }
    return items;
  }
}

export class NewSessionItem extends vscode.TreeItem {
  constructor() {
    super("New Session", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "zcode-new-session";
    this.iconPath = new vscode.ThemeIcon("add");
    this.command = {
      command: "zcode.newSession",
      title: "New Session"
    };
  }
}

export class SessionItem extends vscode.TreeItem {
  contextValue = "zcode-session";

  constructor(session: SessionInfo, active: boolean) {
    super(
      session.title || "Untitled session",
      vscode.TreeItemCollapsibleState.None
    );
    this.id = session.sessionId;
    this.description = [
      new Date(session.updatedAt).toLocaleString(),
      active ? "• active" : undefined
    ].filter(Boolean).join(" · ");
    this.tooltip = `${session.title}\n${session.sessionId}\nmode: ${session.mode}`;
    this.iconPath = new vscode.ThemeIcon("symbol-constant");
    this.command = {
      command: "zcode.resumeSession",
      title: "Resume Session",
      arguments: [session.sessionId]
    };
  }
}

/**
 * Status bar: model · mode · thought level · context usage for the active
 * session, updated from projection snapshots the webview also consumes.
 */

import * as vscode from "vscode";
import type { SessionManager } from "../runtime/sessions.ts";

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.name = "ZCode";
    this.item.command = "zcode.openChat";
    this.item.text = "Z ZCode";
    this.item.tooltip = "ZCode — open chat";
    this.item.show();
  }

  update(manager: SessionManager | undefined, sessionId: string | undefined): void {
    if (!manager || !sessionId) {
      this.item.text = "Z ZCode";
      this.item.tooltip = "ZCode — no active session";
      return;
    }
    const settings = manager.settings(sessionId);
    const model = settings?.model.current?.modelId ?? "model";
    const mode = settings?.mode.current ?? "-";
    const level = settings?.thoughtLevel.enabled ? settings.thoughtLevel.current : undefined;
    this.item.text = `Z ${model} · ${mode}${level ? ` · ${level}` : ""}`;
    this.item.tooltip = new vscode.MarkdownString(
      `**ZCode**\n\n- Model: \`${model}\`\n- Mode: \`${mode}\`${level ? `\n- Thinking: \`${level}\`` : ""}`
    );
  }

  dispose(): void {
    this.item.dispose();
  }
}

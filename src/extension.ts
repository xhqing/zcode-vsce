/**
 * Extension entry: the sidebar hosts the session launcher (New Session +
 * history); conversations open as editor-area tabs (CC-like layout). Commands
 * for model / mode / thought-level switching stay on the palette.
 */

import * as vscode from "vscode";
import { ZcodeController } from "./controller.ts";
import { ChatTab } from "./ui/chat-panel.ts";
import { SessionsTree } from "./ui/sessions-tree.ts";
import { StatusBar } from "./ui/statusbar.ts";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new ZcodeController(context);
  const chat = new ChatTab(context, controller);
  const tree = new SessionsTree(controller);
  const statusbar = new StatusBar();

  context.subscriptions.push(
    controller,
    statusbar,
    vscode.window.createTreeView(SessionsTree.viewId, { treeDataProvider: tree }),
    vscode.commands.registerCommand("zcode.openChat", async () => {
      await chat.open(controller.activeSession);
    }),
    vscode.commands.registerCommand("zcode.newSession", async () => {
      const id = await controller.newSession();
      if (id) {
        await chat.open(id);
        tree.refresh();
      }
    }),
    vscode.commands.registerCommand("zcode.stop", async () => {
      const manager = controller.sessionManager;
      const sessionId = controller.activeSession;
      if (manager && sessionId) await manager.stop(sessionId);
    }),
    vscode.commands.registerCommand("zcode.setModel", async () => {
      const manager = controller.sessionManager;
      const sessionId = controller.activeSession;
      if (!manager || !sessionId) return;
      const settings = manager.settings(sessionId);
      const options = settings?.model.available ?? [];
      if (options.length === 0) return;
      const picked = await vscode.window.showQuickPick(
        options.map((option) => ({
          label: option.label,
          description: `${option.providerLabel} · ${(option.contextWindow / 1000).toFixed(0)}k`,
          ref: option.ref
        })),
        { placeHolder: "Switch model for this session" }
      );
      if (picked) {
        await manager.setModel(sessionId, picked.ref);
        statusbar.update(manager, sessionId);
        await chat.sendBootstrap();
      }
    }),
    vscode.commands.registerCommand("zcode.setMode", async () => {
      const manager = controller.sessionManager;
      const sessionId = controller.activeSession;
      if (!manager || !sessionId) return;
      const picked = await vscode.window.showQuickPick(
        ["build", "edit", "yolo", "plan"].map((mode) => ({
          label: mode,
          description: modeDescriptions[mode]
        })),
        { placeHolder: "Switch permission mode" }
      );
      if (picked) {
        await manager.setMode(sessionId, picked.label);
        statusbar.update(manager, sessionId);
        await chat.sendBootstrap();
      }
    }),
    vscode.commands.registerCommand("zcode.setThoughtLevel", async () => {
      const manager = controller.sessionManager;
      const sessionId = controller.activeSession;
      if (!manager || !sessionId) return;
      const settings = manager.settings(sessionId);
      const options = settings?.thoughtLevel.available ?? [];
      if (options.length === 0) return;
      const picked = await vscode.window.showQuickPick(
        options.map((option) => ({ label: option.label, value: option.value })),
        { placeHolder: "Switch thinking level" }
      );
      if (picked) {
        await manager.setThoughtLevel(sessionId, picked.value);
        statusbar.update(manager, sessionId);
        await chat.sendBootstrap();
      }
    }),
    vscode.commands.registerCommand("zcode.resumeSession", async (sessionId?: string) => {
      if (typeof sessionId !== "string") return;
      await controller.resume(sessionId);
      await chat.open(sessionId);
      tree.refresh();
    }),
    vscode.commands.registerCommand("zcode.forkSession", async (item?: { id?: string }) => {
      const manager = controller.sessionManager;
      const sessionId = item?.id ?? controller.activeSession;
      if (!manager || !sessionId) return;
      const result = await manager.fork(sessionId) as { sessionId?: string } | undefined;
      const forkedId = result?.sessionId;
      if (forkedId) {
        await controller.resume(forkedId);
        await chat.open(forkedId);
      }
      tree.refresh();
    }),
    vscode.commands.registerCommand("zcode.compact", async () => {
      const manager = controller.sessionManager;
      const sessionId = controller.activeSession;
      if (manager && sessionId) await manager.compact(sessionId);
    }),
    controller.onStatus(() => {
      statusbar.update(controller.sessionManager, controller.activeSession);
      tree.refresh();
    })
  );

  // Keep the status bar in sync as events stream in.
  controller.onPanelMessage((message) => {
    if (message.t === "event" && message.sessionId === controller.activeSession) {
      statusbar.update(controller.sessionManager, controller.activeSession);
    }
  });
}

const modeDescriptions: Record<string, string> = {
  build: "Ask before edits and commands (default)",
  edit: "Auto-accept file edits",
  yolo: "Auto-accept everything",
  plan: "Read-only planning mode"
};

export function deactivate(): void {
  // Controller disposal (which stops the runtime) runs from subscriptions.
}

/**
 * Webview UI entry: renders the chat transcript, composer, permission
 * prompts and pickers. Vanilla DOM + a tiny render loop; Markdown via the
 * bundled `marked` (rendered to HTML once per settled block, never during
 * streaming flushes).
 */

import { Store } from "./store.ts";
import { renderMarkdown } from "./markdown.ts";
import { estimateTokens, formatTokenCount } from "./tokens.ts";

const vscode = (globalThis as { acquireVsCodeApi?: () => VscodeApi }).acquireVsCodeApi?.() as VscodeApi;

interface VscodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

const store = new Store();
const root = document.getElementById("root")!;

store.subscribe(render);

interface HostMessage {
  t: string;
  [key: string]: unknown;
}

window.addEventListener("message", (event) => {
  const message = event.data as HostMessage;
  switch (message.t) {
    case "bootstrap": {
      const incomingSessionId = typeof message.sessionId === "string" ? message.sessionId : undefined;
      // Only rebuild the transcript when switching sessions; a same-session
      // bootstrap (post setModel etc.) would wipe streaming deltas mid-turn.
      if (incomingSessionId !== store.state.sessionId) {
        store.reset(incomingSessionId);
      }
      const snapshot = message.snapshot as { messages?: unknown; settings?: { model?: { current?: { modelId?: string } }; mode?: { current?: string } }; projection?: { contextUsed?: number; contextWindow?: number } } | undefined;
      if (snapshot?.messages && !store.state.running) {
        store.loadMessages(snapshot.messages);
      }
      if (snapshot?.settings) {
        store.updateHeader({
          model: snapshot.settings.model?.current?.modelId,
          mode: snapshot.settings.mode?.current,
          contextUsed: snapshot.projection?.contextUsed,
          contextSize: snapshot.projection?.contextWindow
        });
      }
      break;
    }
    case "event":
      if (typeof message.event === "object" && message.event !== null) {
        store.applyEvent(message.event);
      }
      break;
    case "permission":
      store.setPermission(message.request as never);
      break;
    case "userInput":
      store.setUserInput(message.request as never);
      break;
    case "runtimeExit":
      store.addNotice(String(message.message ?? "ZCode runtime exited."), "error");
      break;
    case "notice":
      store.addNotice(String(message.message ?? ""), message.level === "error" ? "error" : "info");
      break;
    case "insert":
      if (typeof message.text === "string") insertAtCursor(message.text);
      break;
    case "uiSettings": {
      const fontSize = Number(message.fontSize);
      if (Number.isFinite(fontSize) && fontSize > 0) applyFontSize(fontSize);
      break;
    }
    default:
      break;
  }
});

vscode?.postMessage({ t: "ready" });

let renderQueued = false;
let structureSignature = "";

/**
 * Render loop: structural changes (entry count, header, prompts) rebuild the
 * DOM; pure content growth inside an existing block updates only that block's
 * node by id. Block ids are stable (`b<entryIdx>-<blockIdx>`), so every
 * streaming delta lands regardless of block kind.
 */
function render(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const state = store.state;
    const signature = [
      state.transcript.length,
      state.transcript.map((entry) => entry.blocks.length).join(","),
      headerSignature(state),
      state.permission?.requestId ?? "",
      state.userInput?.requestId ?? ""
    ].join("|");
    if (signature !== structureSignature) {
      structureSignature = signature;
      root.innerHTML = view(state);
      bindEvents();
      scrollToBottom();
    } else {
      updateStreamingBlocks(state);
    }
  });
}

function headerSignature(state: Store["state"]): string {
  return `${state.model ?? ""}|${state.mode ?? ""}|${state.running}`;
}

function view(state: Store["state"]): string {
  const empty = state.transcript.length === 0;
  return `
    ${empty ? welcomeView() : ""}
    <div class="transcript ${empty ? "empty-state" : ""}" id="transcript">${empty ? "" : renderTranscript(state.transcript)}</div>
    ${renderPermission(state)}
    ${renderUserInput(state)}
    <div class="composer">
      <textarea id="composer-input" placeholder="Ask ZCode anything... (⏎ to send, / for commands)" rows="1"></textarea>
      <div class="composer-bar">
        <div class="composer-left">
          <button class="bar-btn" data-action="attach" title="Attach file">+</button>
          <button class="bar-btn" data-action="commands" title="Slash commands">/</button>
        </div>
        <div class="composer-right">
          <button id="composer-send" class="send ${state.running ? "stop" : ""}" data-action="send"
                  title="${state.running ? "Stop" : "Send"}">${state.running ? "■" : "↑"}</button>
        </div>
      </div>
    </div>
  `;
}

function welcomeView(): string {
  return `
    <div class="welcome">
      <div class="welcome-brand">ZCode</div>
      <div class="welcome-hero">
        <div class="mascot" aria-hidden="true">Z</div>
        <p class="welcome-line">Create an AGENTS.md file with instructions ZCode reads every single time.</p>
      </div>
    </div>
  `;
}

function renderTranscript(transcript: Store["state"]["transcript"]): string {
  return transcript.map((entry, entryIndex) => {
    const blocks = entry.blocks.map((block, blockIndex) => renderBlock(block, entryIndex, blockIndex)).join("");
    return `<div class="entry ${entry.role}">${blocks}</div>`;
  }).join("");
}

function blockId(entryIndex: number, blockIndex: number): string {
  return `b${entryIndex}-${blockIndex}`;
}

function renderBlock(block: unknown, entryIndex = 0, blockIndex = 0): string {
  const value = block as { kind: string; [key: string]: unknown };
  const id = blockId(entryIndex, blockIndex);
  switch (value.kind) {
    case "text":
      return `<div id="${id}" class="block text" data-streaming="true">${renderMarkdown(String(value.text ?? ""))}</div>`;
    case "reasoning":
      return `<details id="${id}" class="block reasoning"><summary>Thinking <span class="token-count" title="Estimated token count">${formatTokenCount(estimateTokens(String(value.text ?? "")))}</span></summary><div>${escapeHtml(String(value.text ?? ""))}</div></details>`;
    case "tool":
      return renderTool(value as never, entryIndex, blockIndex);
    case "error":
      return `<div class="block error">${escapeHtml(String(value.message ?? ""))}</div>`;
    case "notice":
      return `<div class="block notice">${escapeHtml(String(value.message ?? ""))}</div>`;
    default:
      return "";
  }
}

function renderTool(card: { toolCallId: string; toolName: string; status: string; title?: string; outputPreview?: string }, entryIndex = 0, blockIndex = 0): string {
  const icon = card.status === "completed" ? "✓" : card.status === "failed" ? "✗" : card.status === "running" ? "⟳" : "·";
  const output = card.outputPreview
    ? `<pre class="tool-output">${escapeHtml(card.outputPreview.slice(-2000))}</pre>`
    : "";
  return `
    <details id="${blockId(entryIndex, blockIndex)}" class="block tool ${card.status}" data-tool="${escapeHtml(card.toolCallId)}">
      <summary><span class="tool-icon ${card.status}">${icon}</span> ${escapeHtml(card.title ?? card.toolName)}</summary>
      ${output}
    </details>`;
}

function renderPermission(state: Store["state"]): string {
  const permission = state.permission;
  if (!permission) return "";
  const options = permission.options
    .map((option) => `<button class="permission-option" data-permission="${escapeHtml(option.optionId)}">${escapeHtml(option.name)}</button>`)
    .join("");
  return `
    <div class="permission">
      <div class="permission-head">
        <strong>${escapeHtml(permission.toolName)}</strong>
        <span class="badge risk-${escapeHtml(permission.riskLevel)}">${escapeHtml(permission.riskLevel)}</span>
      </div>
      <div class="permission-reason">${escapeHtml(permission.reason)}</div>
      ${options}
    </div>`;
}

function renderUserInput(state: Store["state"]): string {
  const input = state.userInput;
  if (!input) return "";
  if (input.inputType === "choice" && input.choices) {
    const choices = input.choices
      .map((choice) => `<button class="permission-option" data-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`)
      .join("");
    return `<div class="permission"><div class="permission-reason">${escapeHtml(input.prompt)}</div>${choices}</div>`;
  }
  return `
    <div class="permission">
      <div class="permission-reason">${escapeHtml(input.prompt)}</div>
      <div class="permission-actions">
        <input id="user-input-value" type="text" placeholder="Answer…">
        <button class="permission-option" data-user-input="submit">Submit</button>
        <button class="permission-option" data-user-input="cancel">Cancel</button>
      </div>
    </div>`;
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "attach") insertAtCursor("/");
      if (action === "commands") insertAtCursor("/");
      if (action === "send") {
        if (store.state.running) vscode?.postMessage({ t: "stop" });
        else submitComposer();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-permission]").forEach((button) => {
    button.addEventListener("click", () => {
      vscode?.postMessage({ t: "permission", requestId: store.state.permission?.requestId, optionId: button.dataset.permission });
      store.setPermission(undefined);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      vscode?.postMessage({ t: "userInput", requestId: store.state.userInput?.requestId, value: { value: button.dataset.choice } });
      store.setUserInput(undefined);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-user-input]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById("user-input-value") as HTMLInputElement | null;
      const cancelled = button.dataset.userInput === "cancel";
      vscode?.postMessage({
        t: "userInput",
        requestId: store.state.userInput?.requestId,
        value: cancelled ? { cancelled: true } : { value: input?.value ?? "" }
      });
      store.setUserInput(undefined);
    });
  });
  const send = document.getElementById("composer-send");
  const input = document.getElementById("composer-input") as HTMLTextAreaElement | null;
  send?.addEventListener("click", submitComposer);
  input?.addEventListener("input", () => autoGrow(input));
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitComposer();
    }
  });
}

function submitComposer(): void {
  const input = document.getElementById("composer-input") as HTMLTextAreaElement | null;
  const text = input?.value.trim();
  if (!text) return;
  store.addUserMessage(text);
  vscode?.postMessage({ t: "send", text });
  if (input) {
    input.value = "";
    autoGrow(input);
  }
}

/** Insert text at the composer cursor and refocus it (slash-command helper). */
function insertAtCursor(text: string): void {
  const input = document.getElementById("composer-input") as HTMLTextAreaElement | null;
  if (!input) return;
  input.focus();
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
}

/** Chat font size (transcript + composer) is a user setting; apply it live. */
function applyFontSize(fontSize: number): void {
  document.documentElement.style.setProperty("--zcode-font-size", `${fontSize}px`);
}

/** Grow the composer with its content, up to a comfortable cap. */
function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function updateStreamingBlocks(state: Store["state"]): void {
  // Content-only refresh: rewrite the inner HTML of the last few blocks whose
  // kind-level content changed, addressed by stable id. Covers reasoning and
  // tool cards, not just text.
  const entries = state.transcript;
  for (let entryIndex = Math.max(0, entries.length - 2); entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    for (let blockIndex = 0; blockIndex < entry.blocks.length; blockIndex += 1) {
      const block = entry.blocks[blockIndex]!;
      const node = document.getElementById(blockId(entryIndex, blockIndex));
      if (!node) continue;
      if (block.kind === "text" || block.kind === "reasoning") {
        const html = block.kind === "text" ? renderMarkdown(block.text) : escapeHtml(block.text);
        const target = block.kind === "text" ? node as HTMLElement : (node.querySelector("div") ?? node) as HTMLElement;
        if (target.innerHTML !== html) {
          target.innerHTML = html;
          scrollToBottom();
        }
        if (block.kind === "reasoning") {
          const count = node.querySelector<HTMLElement>(".token-count");
          const wanted = formatTokenCount(estimateTokens(block.text));
          if (count && count.textContent !== wanted) count.textContent = wanted;
        }
      } else if (block.kind === "tool") {
        const summary = node.querySelector("summary");
        const icon = block.status === "completed" ? "✓" : block.status === "failed" ? "✗" : block.status === "running" ? "⟳" : "·";
        const wanted = `${icon} ${block.title ?? block.toolName}`;
        if (summary && summary.textContent !== wanted) {
          summary.innerHTML = `<span class="tool-icon ${block.status}">${icon}</span> ${escapeHtml(block.title ?? block.toolName)}`;
          node.className = `block tool ${block.status}`;
          const output = node.querySelector(".tool-output") ?? appendOutput(node);
          const text = block.outputPreview?.slice(-2000) ?? "";
          if (output && output.textContent !== text) {
            output.textContent = text;
            output.className = "tool-output";
          }
          scrollToBottom();
        }
      }
    }
  }
}

function appendOutput(node: HTMLElement): HTMLElement | null {
  const pre = document.createElement("pre");
  pre.className = "tool-output";
  node.appendChild(pre);
  return pre;
}

function scrollToBottom(): void {
  const transcript = document.getElementById("transcript");
  if (transcript) transcript.scrollTop = transcript.scrollHeight;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

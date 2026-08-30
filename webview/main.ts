/**
 * Webview UI entry: renders the chat transcript, composer, permission
 * prompts and pickers. Vanilla DOM + a tiny render loop; Markdown via the
 * bundled `marked` (rendered to HTML once per settled block, never during
 * streaming flushes).
 */

import { Store, type ModelOptionView, type ThoughtLevelOptionView } from "./store.ts";
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

/** Which composer dropdown is open (model / thinking), if any. */
type PickerKind = "model" | "thought";
let openPicker: PickerKind | undefined;
/** Guard so the outside-click closer is registered exactly once. */
let outsideClickBound = false;

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
        openPicker = undefined;
      }
      const snapshot = message.snapshot as {
        messages?: unknown;
        settings?: SettingsSnapshot;
        projection?: { contextUsed?: number; contextWindow?: number };
      } | undefined;
      if (snapshot?.messages && !store.state.running) {
        store.loadMessages(snapshot.messages);
      }
      if (snapshot?.settings) {
        applySettingsToStore(snapshot.settings);
        store.updateHeader({
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
    case "settingsChanged":
      if (message.settings && typeof message.settings === "object") {
        applySettingsToStore(message.settings as SettingsSnapshot);
      }
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
      // Preserve the composer draft (text + caret) across structural rebuilds
      // — e.g. opening a picker must not wipe what the user has typed.
      const previous = document.getElementById("composer-input") as HTMLTextAreaElement | null;
      const draft = previous ? { value: previous.value, start: previous.selectionStart, end: previous.selectionEnd } : undefined;
      root.innerHTML = view(state);
      bindEvents();
      restoreDraft(draft);
      scrollToBottom();
    } else {
      updateStreamingBlocks(state);
    }
  });
}

function headerSignature(state: Store["state"]): string {
  return `${state.model ?? ""}|${state.mode ?? ""}|${state.running}|${openPicker ?? ""}`
    + `|${state.thoughtEnabled ? state.thoughtLevel ?? "" : ""}`;
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
      ${renderPickers(state)}
      <div class="composer-bar">
        <div class="composer-left">
          <button class="bar-btn" data-action="attach" title="Attach file">+</button>
          <button class="bar-btn" data-action="commands" title="Slash commands">/</button>
        </div>
        <div class="composer-right">
          <button class="bar-btn picker-toggle ${openPicker === "model" ? "active" : ""}" data-action="model"
                  title="Switch model">${escapeHtml(modelShortName(state))} ▾</button>
          ${state.thoughtEnabled
            ? `<button class="bar-btn picker-toggle ${openPicker === "thought" ? "active" : ""}" data-action="thought"
                  title="Switch thinking level">${escapeHtml(thoughtShortLabel(state))} ▾</button>`
            : ""}
          <button id="composer-send" class="send ${state.running ? "stop" : ""}" data-action="send"
                  title="${state.running ? "Stop" : "Send"}">${state.running ? "■" : "↑"}</button>
        </div>
      </div>
    </div>
  `;
}

/** Model / thinking dropdowns sit between the textarea and the bar (CC-like). */
function renderPickers(state: Store["state"]): string {
  if (openPicker === "model") {
    const items = state.modelOptions.map((option) => {
      const current = state.modelRef?.providerId === option.ref.providerId
        && state.modelRef?.modelId === option.ref.modelId;
      return `
        <button class="picker-item ${current ? "current" : ""}" data-model-pick="${escapeHtml(option.ref.providerId)}|${escapeHtml(option.ref.modelId)}">
          <span class="picker-item-label">${escapeHtml(option.label)}</span>
          <span class="picker-item-detail">${escapeHtml(option.providerLabel)} · ${(option.contextWindow / 1000).toFixed(0)}k</span>
          ${current ? '<span class="picker-item-check">✓</span>' : ""}
        </button>`;
    }).join("");
    return `<div class="picker open" id="picker-model">${items || '<div class="picker-empty">No models available</div>'}</div>`;
  }
  if (openPicker === "thought") {
    const items = state.thoughtOptions.map((option) => {
      const current = state.thoughtLevel === option.value;
      return `
        <button class="picker-item ${current ? "current" : ""}" data-thought-pick="${escapeHtml(option.value)}">
          <span class="picker-item-label">${escapeHtml(option.label)}</span>
          ${current ? '<span class="picker-item-check">✓</span>' : ""}
        </button>`;
    }).join("");
    return `<div class="picker open" id="picker-thought">${items || '<div class="picker-empty">No levels available</div>'}</div>`;
  }
  return "";
}

/** Short composer label for the current model (e.g. "glm-4.7" → "4.7"). */
function modelShortName(state: Store["state"]): string {
  const modelId = state.modelRef?.modelId ?? state.model;
  if (!modelId) return "Model";
  const segments = modelId.split(/[/.]/);
  const last = segments[segments.length - 1] ?? modelId;
  return last.length <= 12 ? last : modelId.slice(0, 12);
}

/** Short composer label for the current thinking level. */
function thoughtShortLabel(state: Store["state"]): string {
  const value = state.thoughtLevel;
  const match = state.thoughtOptions.find((option) => option.value === value);
  if (match) return match.label;
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Thinking";
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
      if (action === "model" || action === "thought") {
        openPicker = openPicker === action ? undefined : action;
        render();
      }
      if (action === "send") {
        if (store.state.running) vscode?.postMessage({ t: "stop" });
        else submitComposer();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-model-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const [providerId, modelId] = String(button.dataset.modelPick ?? "").split("|");
      if (providerId && modelId) {
        vscode?.postMessage({ t: "setModel", model: { providerId, modelId } });
      }
      openPicker = undefined;
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-thought-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = String(button.dataset.thoughtPick ?? "");
      if (value) vscode?.postMessage({ t: "setThoughtLevel", thoughtLevel: value });
      openPicker = undefined;
      render();
    });
  });
  // Close an open dropdown when clicking anywhere outside it. Registered once
  // on a stable node (document) — bindEvents runs on every structural rebuild.
  if (!outsideClickBound) {
    outsideClickBound = true;
    document.addEventListener("click", (event) => {
      if (!openPicker) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".picker") || target?.closest("[data-action='model']") || target?.closest("[data-action='thought']")) return;
      openPicker = undefined;
      render();
    });
  }
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
function insertAtCursor(text: string): void {  const input = document.getElementById("composer-input") as HTMLTextAreaElement | null;
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

/** Shape of the session settings snapshot pushed by the host (subset we use). */
interface SettingsSnapshot {
  model?: {
    current?: { providerId?: string; modelId?: string };
    available?: Array<{ ref?: { providerId?: string; modelId?: string }; label?: string; providerLabel?: string; contextWindow?: number }>;
  };
  thoughtLevel?: {
    enabled?: boolean;
    current?: string;
    available?: Array<{ value?: string; label?: string }>;
  };
  mode?: { current?: string };
}

/** Project a settings snapshot into the composer picker state. */
function applySettingsToStore(settings: SettingsSnapshot): void {
  const current = settings.model?.current;
  const available = (settings.model?.available ?? []).filter(
    (option): option is { ref: { providerId: string; modelId: string }; label: string; providerLabel: string; contextWindow: number } =>
      typeof option.ref?.providerId === "string" && typeof option.ref?.modelId === "string"
  ).map((option) => ({
    ref: { providerId: option.ref.providerId!, modelId: option.ref.modelId! },
    label: option.label ?? option.ref.modelId!,
    providerLabel: option.providerLabel ?? option.ref.providerId!,
    contextWindow: typeof option.contextWindow === "number" ? option.contextWindow : 0
  }));
  const thoughtAvailable = (settings.thoughtLevel?.available ?? []).filter(
    (option): option is { value: string; label: string } =>
      typeof option.value === "string"
  ).map((option) => ({
    value: option.value,
    label: option.label ?? option.value
  }));
  store.updateHeader({
    model: current?.modelId,
    mode: settings.mode?.current,
    modelRef: current && typeof current.providerId === "string" && typeof current.modelId === "string"
      ? { providerId: current.providerId, modelId: current.modelId }
      : undefined,
    modelOptions: available as ModelOptionView[],
    thoughtEnabled: settings.thoughtLevel?.enabled === true,
    thoughtLevel: settings.thoughtLevel?.current,
    thoughtOptions: thoughtAvailable as ThoughtLevelOptionView[]
  });
}

/** Grow the composer with its content, up to a comfortable cap. */
function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

/** Restore composer text + selection captured just before a rebuild. */
function restoreDraft(draft: { value: string; start: number | null; end: number | null } | undefined): void {
  if (!draft) return;
  const input = document.getElementById("composer-input") as HTMLTextAreaElement | null;
  if (!input) return;
  input.value = draft.value;
  input.setSelectionRange(draft.start ?? draft.value.length, draft.end ?? draft.value.length);
  autoGrow(input);
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

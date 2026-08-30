/**
 * Sidebar webview UI: CC-extension-style session launcher — a large
 * "New session" button on top, a search box, and the resumable session list
 * with per-session actions (rename, delete) and a live "Running" badge.
 * Plain DOM, no framework; all data arrives via postMessage from the host.
 */

const vscode = (globalThis as { acquireVsCodeApi?: () => VscodeApi }).acquireVsCodeApi?.() as VscodeApi;

interface VscodeApi {
  postMessage(message: unknown): void;
}

interface SessionRow {
  sessionId: string;
  title: string;
  updatedAt: number;
  status?: string;
  active?: boolean;
  customTitle?: string;
}

interface SidebarState {
  loaded: boolean;
  query: string;
  sessions: SessionRow[];
  renamingId?: string;
  settingsOpen: boolean;
  fontSize: number;
}

const defaultFontSize = 13;
const minFontSize = 10;
const maxFontSize = 24;

const state: SidebarState = { loaded: false, query: "", sessions: [], settingsOpen: false, fontSize: defaultFontSize };

const root = document.getElementById("root")!;

window.addEventListener("message", (event) => {
  const message = event.data as { t: string; [key: string]: unknown };
  switch (message.t) {
    case "sessions":
      state.loaded = true;
      state.sessions = (message.sessions as SessionRow[]) ?? [];
      break;
    case "renaming":
      state.renamingId = typeof message.sessionId === "string" ? message.sessionId : undefined;
      break;
    case "toggleSettings":
      state.settingsOpen = !state.settingsOpen;
      break;
    case "uiSettings": {
      const size = Number(message.fontSize);
      if (Number.isFinite(size) && size >= minFontSize && size <= maxFontSize) {
        state.fontSize = size;
      }
      break;
    }
    default:
      return;
  }
  render();
});

vscode.postMessage({ t: "ready" });

function filtered(): SessionRow[] {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.sessions;
  return state.sessions.filter((session) =>
    session.title.toLowerCase().includes(query)
    || (session.customTitle ?? "").toLowerCase().includes(query)
  );
}

function timeAgo(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function render(): void {
  root.innerHTML = view();
  bind();
}

function view(): string {
  const rows = filtered();
  return `
    ${state.settingsOpen ? settingsPanel() : ""}
    <button id="new-session" title="Start a new session">
      <span class="plus">+</span> New session
    </button>
    <div class="search">
      <span class="search-icon">⌕</span>
      <input id="search-input" type="text" placeholder="Search sessions..."
             value="${escapeHtml(state.query)}" spellcheck="false">
    </div>
    <div class="list">
      ${rows.length === 0 ? `<div class="empty">${state.loaded ? "No sessions yet." : "Loading…"}</div>` : rows.map(rowHtml).join("")}
    </div>
    ${state.renamingId ? renameOverlay() : ""}
  `;
}

/** Expandable settings card: the home for user-adjustable UI settings. */
function settingsPanel(): string {
  return `
    <div class="settings">
      <div class="settings-title">Settings</div>
      <div class="setting-row">
        <span class="setting-label">Font size <span class="setting-hint">(chat &amp; input)</span></span>
        <div class="stepper">
          <button data-font="dec" title="Smaller font" ${state.fontSize <= minFontSize ? "disabled" : ""}>−</button>
          <span class="stepper-value">${state.fontSize}px</span>
          <button data-font="inc" title="Larger font" ${state.fontSize >= maxFontSize ? "disabled" : ""}>+</button>
        </div>
      </div>
    </div>
  `;
}

function rowHtml(session: SessionRow): string {
  const running = session.status === "running";
  return `
    <div class="row ${session.active ? "active" : ""}" data-id="${escapeAttr(session.sessionId)}">
      <div class="row-main" data-action="open">
        <div class="title">${escapeHtml(session.title)}</div>
        <div class="meta">
          ${running ? '<span class="running"><span class="dot"></span>Running</span>' : ""}
          <span class="ago">${timeAgo(session.updatedAt)}</span>
        </div>
      </div>
      <div class="row-actions">
        <button class="action" data-action="rename" title="Rename">✎</button>
        <button class="action" data-action="delete" title="Delete">🗑</button>
      </div>
    </div>
  `;
}

function renameOverlay(): string {
  const session = state.sessions.find((candidate) => candidate.sessionId === state.renamingId);
  return `
    <div class="overlay" data-action="cancel-rename">
      <div class="dialog" data-action="stop">
        <div class="dialog-title">Rename session</div>
        <input id="rename-input" type="text" value="${escapeAttr(session?.title ?? "")}" spellcheck="false">
        <div class="dialog-buttons">
          <button id="rename-cancel" data-action="cancel-rename">Cancel</button>
          <button id="rename-save" class="primary" data-action="save-rename">Save</button>
        </div>
      </div>
    </div>
  `;
}

function bind(): void {
  // Clicking outside the settings card closes it (the gear lives in the native
  // view title bar now, so dismissal happens on the webview side).
  root.addEventListener("click", (event) => {
    if (!state.settingsOpen) return;
    if ((event.target as HTMLElement).closest(".settings")) return;
    state.settingsOpen = false;
    render();
  });

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-font]")) {
    button.addEventListener("click", () => {
      const step = button.dataset.font === "inc" ? 1 : -1;
      const next = Math.min(maxFontSize, Math.max(minFontSize, state.fontSize + step));
      if (next === state.fontSize) return;
      state.fontSize = next;
      vscode.postMessage({ t: "setFontSize", fontSize: next });
      const value = root.querySelector(".stepper-value");
      if (value) value.textContent = `${next}px`;
      for (const other of root.querySelectorAll<HTMLButtonElement>("[data-font]")) {
        other.disabled = (other.dataset.font === "inc" && next >= maxFontSize)
          || (other.dataset.font === "dec" && next <= minFontSize);
      }
    });
  }

  document.getElementById("new-session")?.addEventListener("click", () => {
    vscode.postMessage({ t: "newSession" });
  });

  const search = document.getElementById("search-input") as HTMLInputElement | null;
  search?.addEventListener("input", () => {
    state.query = search.value;
    refreshList();
  });

  for (const row of root.querySelectorAll<HTMLElement>(".row")) {
    const sessionId = row.dataset.id ?? "";
    for (const button of row.querySelectorAll<HTMLElement>("[data-action]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = button.dataset.action;
        if (action === "open") vscode.postMessage({ t: "open", sessionId });
        if (action === "rename") vscode.postMessage({ t: "requestRename", sessionId });
        if (action === "delete") vscode.postMessage({ t: "requestDelete", sessionId });
      });
    }
  }

  const input = document.getElementById("rename-input") as HTMLInputElement | null;
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveRename();
    if (event.key === "Escape") vscode.postMessage({ t: "cancelRename" });
  });
  input?.focus();
  input?.select();

  document.getElementById("rename-save")?.addEventListener("click", saveRename);
  for (const element of root.querySelectorAll<HTMLElement>("[data-action='cancel-rename']")) {
    element.addEventListener("click", (event) => {
      if (event.target !== element) return;
      vscode.postMessage({ t: "cancelRename" });
    });
  }
}

function saveRename(): void {
  const input = document.getElementById("rename-input") as HTMLInputElement | null;
  const title = input?.value.trim();
  if (input && title) vscode.postMessage({ t: "rename", sessionId: state.renamingId, title });
}

/** Re-render only the list section, preserving focus inside the search box. */
function refreshList(): void {
  const list = root.querySelector(".list");
  if (!list) return;
  const rows = filtered();
  list.innerHTML = rows.length === 0
    ? `<div class="empty">${state.loaded ? "No matching sessions." : "Loading…"}</div>`
    : rows.map(rowHtml).join("");
  for (const row of list.querySelectorAll<HTMLElement>(".row")) {
    const sessionId = row.dataset.id ?? "";
    for (const button of row.querySelectorAll<HTMLElement>("[data-action]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = button.dataset.action;
        if (action === "open") vscode.postMessage({ t: "open", sessionId });
        if (action === "rename") vscode.postMessage({ t: "requestRename", sessionId });
        if (action === "delete") vscode.postMessage({ t: "requestDelete", sessionId });
      });
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

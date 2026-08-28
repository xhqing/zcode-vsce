/**
 * Webview-side state store: projects raw session events into a renderable
 * transcript. Event `payload.kind` is the authoritative discriminator
 * (turn_started / text_delta / reasoning_delta / turn_complete / turn_error /
 * tool_call_* / model_request_* — verified against runtime 3.8.1, see
 * docs/PROTOCOL.md §3).
 */

export interface ToolCard {
  kind: "tool";
  toolCallId: string;
  toolName: string;
  status: "pending" | "running" | "completed" | "failed";
  title?: string;
  inputPreview?: string;
  outputPreview?: string;
}

export interface TextBlock {
  kind: "text" | "reasoning";
  messageId?: string;
  text: string;
}

export interface ErrorBlock {
  kind: "error";
  message: string;
}

export interface NoticeBlock {
  kind: "notice";
  message: string;
}

export type TranscriptBlock = ToolCard | TextBlock | ErrorBlock | NoticeBlock;

export interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  blocks: TranscriptBlock[];
}

export interface PermissionPrompt {
  requestId: string;
  toolName: string;
  reason: string;
  riskLevel: string;
  inputPreview?: string;
  options: Array<{ optionId: string; name: string; description?: string }>;
}

export interface UserInputPrompt {
  requestId: string;
  prompt: string;
  inputType?: "text" | "choice" | "confirm";
  choices?: string[];
}

export interface StoreState {
  sessionId?: string;
  running: boolean;
  transcript: TranscriptEntry[];
  permission?: PermissionPrompt;
  userInput?: UserInputPrompt;
  model?: string;
  mode?: string;
  contextUsed?: number;
  contextSize?: number;
  lastResponseTokens?: number;
}

interface RawEvent {
  type?: string;
  kind?: string;
  delta?: string;
  field?: string;
  done?: boolean;
  messageId?: string;
  assistantMessageId?: string;
  partId?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  result?: unknown;
  output?: unknown;
  error?: unknown;
  message?: string;
  content?: string;
  toolCall?: { id?: string; name?: string; input?: unknown; output?: unknown; error?: unknown };
  part?: RawPart;
  turnNumber?: number;
  response?: string;
  tokenCount?: number;
}

interface RawPart {
  type?: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  callId?: string;
  tool?: string;
  state?: { status?: string; title?: string; output?: string; error?: string; input?: unknown };
}

const maxTranscriptEntries = 500;

export class Store {
  state: StoreState = { running: false, transcript: [] };
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  reset(sessionId: string | undefined): void {
    this.state = { sessionId, running: false, transcript: [] };
    this.emit();
  }

  addNotice(message: string, level: "info" | "error" = "info"): void {
    this.pushBlock("system", level === "error" ? { kind: "error", message } : { kind: "notice", message });
    this.emit();
  }

  addUserMessage(text: string): void {
    this.pushBlock("user", { kind: "text", text });
    this.emit();
  }

  setPermission(prompt: PermissionPrompt | undefined): void {
    this.state.permission = prompt;
    this.emit();
  }

  setUserInput(prompt: UserInputPrompt | undefined): void {
    this.state.userInput = prompt;
    this.emit();
  }

  setRunning(running: boolean): void {
    if (this.state.running !== running) {
      this.state.running = running;
      this.emit();
    }
  }

  updateHeader(header: Partial<Pick<StoreState, "model" | "mode" | "contextUsed" | "contextSize" | "lastResponseTokens">>): void {
    Object.assign(this.state, header);
    this.emit();
  }

  /** Apply one raw session/event payload (envelope already stripped). */
  applyEvent(raw: unknown): void {
    const event = (raw ?? {}) as RawEvent;
    const kind = event.kind ?? event.type;
    switch (kind) {
      case "turn_started":
        this.state.lastResponseTokens = undefined;
        this.setRunning(true);
        break;
      case "turn_complete": {
        this.setRunning(false);
        if (typeof event.tokenCount === "number") {
          this.state.lastResponseTokens = event.tokenCount;
        }
        break;
      }
      case "turn_error": {
        this.setRunning(false);
        const message = errorMessage(event.error) ?? event.message;
        if (message) this.pushBlock("assistant", { kind: "error", message });
        break;
      }
      case "text_delta":
        this.appendDelta("text", event.delta ?? "", event.assistantMessageId ?? event.messageId);
        break;
      case "reasoning_delta":
        this.appendDelta("reasoning", event.delta ?? "", event.assistantMessageId ?? event.messageId);
        break;
      case "tool_call_scheduled":
      case "tool_call_started":
        this.upsertToolCard({
          kind: "tool",
          toolCallId: event.toolCall?.id ?? event.toolCallId ?? "",
          toolName: event.toolCall?.name ?? event.toolName ?? "tool",
          status: kind === "tool_call_scheduled" ? "pending" : "running",
          inputPreview: previewOf(event.toolCall?.input ?? event.input)
        });
        break;
      case "tool_call_progress":
        this.upsertToolCard({
          kind: "tool",
          toolCallId: event.toolCall?.id ?? event.toolCallId ?? "",
          toolName: event.toolCall?.name ?? event.toolName ?? "tool",
          status: "running"
        });
        break;
      case "tool_call_result":
        this.upsertToolCard({
          kind: "tool",
          toolCallId: event.toolCall?.id ?? event.toolCallId ?? "",
          toolName: event.toolCall?.name ?? event.toolName ?? "tool",
          status: "completed",
          outputPreview: previewOf(event.toolCall?.output ?? event.result ?? event.output)
        });
        break;
      case "tool_call_error":
        this.upsertToolCard({
          kind: "tool",
          toolCallId: event.toolCall?.id ?? event.toolCallId ?? "",
          toolName: event.toolCall?.name ?? event.toolName ?? "tool",
          status: "failed",
          outputPreview: errorMessage(event.error) ?? event.message
        });
        break;
      case "model_request_failed": {
        const message = errorMessage(event.error) ?? event.message;
        if (message && !this.state.running) {
          this.pushBlock("assistant", { kind: "error", message });
        }
        break;
      }
      default:
        break;
    }
    this.emit();
  }

  /** Load full transcript from a snapshot messages array. */
  loadMessages(messages: unknown): void {
    if (!Array.isArray(messages)) return;
    const transcript: TranscriptEntry[] = [];
    for (const message of messages as Array<{ info?: { role?: string }; parts?: RawPart[] }>) {
      const role = message.info?.role === "user" ? "user"
        : message.info?.role === "assistant" ? "assistant"
        : "system";
      const blocks: TranscriptBlock[] = [];
      for (const part of message.parts ?? []) {
        const block = blockFromPart(part);
        if (block) blocks.push(block);
      }
      if (blocks.length > 0) transcript.push({ role, blocks });
    }
    this.state.transcript = transcript.slice(-maxTranscriptEntries);
    this.emit();
  }

  private appendDelta(kind: "text" | "reasoning", text: string, messageId?: string): void {
    if (!text) return;
    const entry = this.ensureAssistantEntry();
    const last = entry.blocks[entry.blocks.length - 1];
    if (last && last.kind === kind) {
      (last as TextBlock).text += text;
    } else {
      entry.blocks.push({ kind, messageId, text });
    }
    this.trim();
  }

  private upsertToolCard(card: ToolCard): void {
    if (!card.toolCallId) return;
    const entry = this.ensureAssistantEntry();
    const existing = entry.blocks.find(
      (block) => block.kind === "tool" && (block as ToolCard).toolCallId === card.toolCallId
    ) as ToolCard | undefined;
    if (existing) {
      Object.assign(existing, {
        ...card,
        title: card.title ?? existing.title,
        inputPreview: card.inputPreview ?? existing.inputPreview,
        outputPreview: card.outputPreview ?? existing.outputPreview
      });
    } else {
      entry.blocks.push(card);
    }
    this.trim();
  }

  private ensureAssistantEntry(): TranscriptEntry {
    let entry = this.state.transcript[this.state.transcript.length - 1];
    if (!entry || entry.role !== "assistant") {
      entry = { role: "assistant", blocks: [] };
      this.state.transcript.push(entry);
    }
    return entry;
  }

  private pushBlock(role: TranscriptEntry["role"], block: TranscriptBlock): void {
    this.state.transcript.push({ role, blocks: [block] });
    this.trim();
  }

  private trim(): void {
    if (this.state.transcript.length > maxTranscriptEntries) {
      this.state.transcript = this.state.transcript.slice(-maxTranscriptEntries);
    }
  }
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

function previewOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.slice(0, 4000);
  try {
    return JSON.stringify(value, null, 1).slice(0, 4000);
  } catch {
    return String(value).slice(0, 4000);
  }
}

function blockFromPart(part: RawPart): TranscriptBlock | undefined {
  if (part?.type === "text") return { kind: "text", text: part.text ?? "" };
  if (part?.type === "reasoning") return { kind: "reasoning", text: part.text ?? "" };
  if (part?.type === "tool") {
    const state = part.state;
    return {
      kind: "tool",
      toolCallId: part.callId ?? part.toolCallId ?? "",
      toolName: part.tool ?? part.toolName ?? "tool",
      status: state?.status === "error" ? "failed" : state?.status === "completed" ? "completed" : "running",
      title: state?.title,
      outputPreview: (state?.output ?? state?.error ?? "").slice(0, 4000) || undefined
    };
  }
  return undefined;
}

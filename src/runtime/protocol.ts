/**
 * ZCode app-server protocol types.
 *
 * Field names and shapes were extracted from the official runtime bundle
 * (vendor/zcode.cjs, ZCode Desktop 3.8.1) by string analysis plus runtime
 * probing; see docs/PROTOCOL.md for the recorded schema evidence.
 */

export type PermissionMode = "plan" | "build" | "edit" | "yolo" | "auto";
export type SessionStatus = "idle" | "running" | "waiting" | "paused" | "completed" | "error";
export type DeliveryKind = "desktop-continuous" | "web-remote-replayable";

export interface WorkspaceRef {
  workspacePath: string;
  workspaceKey: string;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
  variant?: string;
}

export interface SessionInfo {
  sessionId: string;
  workspace: WorkspaceRef;
  parentSessionId?: string;
  sessionKind: string;
  title: string;
  titleSource?: "default" | "first_input" | "generated" | "custom";
  mode: PermissionMode;
  status: SessionStatus;
  model?: ModelRef;
  createdAt: number;
  updatedAt: number;
}

export interface ModelOption {
  ref: ModelRef;
  label: string;
  providerLabel: string;
  contextWindow: number;
}

export interface ThoughtLevelOption {
  value: string;
  label: string;
}

export interface SessionSettings {
  model: {
    current: ModelRef;
    available: ModelOption[];
    lastUsed?: ModelRef;
  };
  thoughtLevel: {
    enabled: boolean;
    current?: string;
    defaultLevel?: string;
    available: ThoughtLevelOption[];
  };
  mode: { current: PermissionMode };
  permission?: { mode?: PermissionMode; rulesRevision?: number };
}

export interface ActiveToolCall {
  toolCallId: string;
  toolName: string;
  status: "pending" | "running" | "completed" | "failed" | "denied";
  startedAt?: number;
}

export interface ContextUsage {
  used: number;
  size: number;
  cost?: { amount: number; currency: string } | null;
  cache?: Record<string, number | null>;
  breakdown?: Array<{ source: string; chars: number }>;
}

export interface Projection {
  sessionId: string;
  status: SessionStatus;
  mode: PermissionMode;
  turnCount: number;
  totalTokenCount: number;
  currentTurnId?: string;
  activeToolCalls: ActiveToolCall[];
  backgroundJobs: unknown[];
  contextUsed: number;
  contextWindow: number;
  contextUsage?: ContextUsage;
  lastError?: { type: string; code?: string; message: string; detail?: string };
}

export interface RuntimeInfo {
  eventSeq: number;
  stateRevision: number;
  pendingRequestIds: string[];
  deliveryKind?: DeliveryKind;
}

/** Restored message part (see normalizeRestoredPart for the tolerant mapper). */
export type ProtocolPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "file"; mime: string; filename?: string; url: string }
  | { type: "step-start"; snapshot?: string }
  | { type: "step-finish"; reason: string; snapshot?: string; cost: number; tokens: unknown }
  | { type: "snapshot"; snapshot: string }
  | { type: "patch"; hash: string; files: string[] }
  | { type: "compaction"; auto: boolean; reason?: string }
  | {
    type: "tool";
    callId: string;
    tool: string;
    state:
      | { status: "pending"; input?: unknown }
      | { status: "running"; input?: unknown; title?: string; startedAt: number }
      | { status: "completed"; input?: unknown; output: string; title: string; startedAt: number; completedAt: number }
      | { status: "error"; input?: unknown; error: string; startedAt: number; completedAt: number };
  };

export interface MessageInfo {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant";
}

export interface RestoredMessage {
  info: MessageInfo;
  parts: Array<ProtocolPart & { partId?: string }>;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  inputHint?: string;
  source?: "builtin" | "custom";
}

export interface SessionSnapshot {
  protocol: { name: string; version: number };
  session: SessionInfo;
  settings: SessionSettings;
  projection: Projection;
  runtime: RuntimeInfo;
  messages: RestoredMessage[];
  slashCommands?: SlashCommandInfo[];
}

/** Envelope of a `session/event` notification. */
export interface SessionEventEnvelope {
  sessionId: string;
  eventId: string;
  seq: number;
  timestamp: number;
  turnId?: string;
  traceId?: string;
  deliveryKind?: DeliveryKind;
  payload: Record<string, unknown> & { type: string };
}

export interface PermissionOption {
  optionId: string;
  kind: string;
  name: string;
  description?: string;
  response: {
    decision: "allow" | "deny" | "escalate" | "modify";
    reason?: string;
    permissionUpdates?: Array<{
      type: "addRules";
      behavior: "allow" | "deny" | "ask";
      rules: Array<{ toolName: string; ruleContent?: string }>;
    }>;
  };
}

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  turnId?: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  input?: unknown;
  origin?: Record<string, unknown>;
  options: PermissionOption[];
}

export interface PermissionResponse {
  decision: "allow" | "deny" | "escalate" | "modify";
  reason?: string;
  permissionUpdates?: PermissionOption["response"]["permissionUpdates"];
}

export interface UserInputRequest {
  requestId: string;
  prompt: string;
  inputType?: "text" | "choice" | "confirm";
  choices?: string[];
}

/** Result payload of `session/create` / `session/resume`. */
export interface SessionBootstrap {
  session: SessionInfo;
  settings: SessionSettings;
  projection: Projection;
  runtime: RuntimeInfo;
  messages: RestoredMessage[];
  slashCommands?: SlashCommandInfo[];
}

export interface AttachmentRef {
  ref: string;
  fileName: string;
  mime: string;
  bytes: number;
}

/**
 * Default reply for `session/requestRuntimePreferences`: the strict server
 * schema requires `nativeSearchEnhancementsEnabled` as a boolean (no default
 * on the response side), everything else has defaults.
 */
export const defaultRuntimePreferences = {
  nativeSearchEnhancementsEnabled: false,
  memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true,
  modelContextBudgetStrategy: "preflight-v1"
} as const;

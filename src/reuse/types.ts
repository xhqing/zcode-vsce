/**
 * Shared value guards (ported from zcode-tui types.ts; runtime-projection /
 * events normalizers depend on them).
 */

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Tool progress payload carried by tool_call_progress events. */
export interface ToolProgressData {
  elapsedMs?: number;
  durationMs?: number;
  pid?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  outputBytes?: number;
  stdoutTail?: string;
  stderrTail?: string;
  description?: string;
  progress?: number;
  total?: number;
  progressMessage?: string;
  parentToolCallId?: string;
  agentId?: string;
  agentType?: string;
  childSessionId?: string;
  childToolCallId?: string;
  totalToolUseCount?: number;
  totalTokens?: number;
  outputFile?: string;
  backgroundTaskId?: string;
}

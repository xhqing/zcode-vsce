/**
 * RuntimeHost: spawn and supervise the external node + vendor/zcode.cjs
 * app-server process.
 *
 * The runtime requires Node >= 22.19 and the extension host's bundled Node is
 * not under our control, so we always spawn an external interpreter, resolved
 * in this order: `zcode.nodeExecutable` setting → ZCODE_NODE env → `node`
 * on PATH (same resolution as the zcode-cli launcher).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";

import { JsonRpcConnection } from "./connection.ts";

const runtimeLogLimitBytes = 2 * 1024 * 1024;

export interface RuntimeSpawnOptions {
  nodeExecutable: string;
  runtimePath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export class RuntimeHost extends EventEmitter {
  private child: ChildProcess | undefined;
  private connection: JsonRpcConnection | undefined;
  private intentionalExit = false;
  private logInitialized = false;
  private logBytes = 0;
  private logPath: string | undefined;
  private logWriteFailed = false;
  private stderrTail = "";

  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null && !this.intentionalExit;
  }

  get connectionInstance(): JsonRpcConnection | undefined {
    return this.connection;
  }

  /** Spawn the app-server and return the connected JSON-RPC channel. */
  start(options: RuntimeSpawnOptions): JsonRpcConnection {
    if (this.child && this.child.exitCode === null && !this.intentionalExit) {
      return this.connection!;
    }
    this.intentionalExit = false;

    const child = spawn(options.nodeExecutable, [options.runtimePath, "app-server"], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;

    const connection = new JsonRpcConnection({
      write: (line) => {
        child.stdin?.write(line);
      }
    });
    this.connection = connection;
    child.stdin?.on("error", () => {}); // EPIPE during shutdown is expected
    child.stdout?.on("data", (chunk: Buffer) => connection.receive(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.appendRuntimeLog(chunk));
    child.once("error", (error) => {
      this.appendRuntimeLog(`spawn error: ${error.stack ?? error.message}\n`);
      this.teardown(new Error(`Failed to start the ZCode runtime: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      this.appendRuntimeLog(`runtime exited (code=${code ?? "null"} signal=${signal ?? "null"})\n`);
      this.teardown(new Error(`ZCode runtime exited (code=${code ?? signal ?? "unknown"}).`));
    });

    connection.on("notification", (method, params) => {
      this.emit("notification", method, params);
    });
    return connection;
  }

  /** Orderly shutdown: SIGTERM then SIGKILL after a grace period. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    this.intentionalExit = true;
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
      killTimer.unref();
      child.once("close", () => {
        clearTimeout(killTimer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  /** Diagnostic tail of runtime stderr for user-facing error messages. */
  stderrSummary(): string {
    return this.stderrTail.trim().split("\n").slice(-8).join("\n");
  }

  private teardown(error: Error): void {
    this.connection?.close();
    this.emit("exit", error, this.intentionalExit);
  }

  private appendRuntimeLog(chunk: Buffer | string): void {
    const text = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.stderrTail = (this.stderrTail + text.toString("utf8")).slice(-16 * 1024);
    if (this.logWriteFailed) return;
    try {
      const path = this.logPath ?? join(homedir(), ".zcode", "vsce", "runtime.log");
      this.logPath = path;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (!this.logInitialized) {
        this.logInitialized = true;
        if (existsSync(path)) {
          const existing = statSync(path).size;
          if (existing >= runtimeLogLimitBytes) {
            const rotated = `${path}.1`;
            if (existsSync(rotated)) unlinkSync(rotated);
            renameSync(path, rotated);
            chmodSync(rotated, 0o600);
          } else {
            this.logBytes = existing;
          }
        }
      }
      if (this.logBytes >= runtimeLogLimitBytes) return;
      const bounded = text.subarray(0, runtimeLogLimitBytes - this.logBytes);
      if (bounded.byteLength === 0) return;
      appendFileSync(path, bounded, { mode: 0o600 });
      this.logBytes += bounded.byteLength;
    } catch {
      this.logWriteFailed = true;
    }
  }
}

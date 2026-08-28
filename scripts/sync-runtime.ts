#!/usr/bin/env bun
/**
 * sync-runtime for zcode-vsce: extract the official ZCode runtime into
 * vendor/ the same way zcode-cli does, minus every TUI bridge patch — the
 * extension drives the runtime purely through the app-server protocol.
 *
 * Sources, in priority order:
 *   --app /Applications/ZCode.app   local ZCode Desktop install
 *   --lock zcode-runtime.lock.json  pinned remote release (sha512-verified)
 *   (default)                       latest stable manifest
 *
 * The lock file mirrors zcode-cli's so both projects can stay byte-identical
 * on the same upstream version.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "zcode-runtime.lock.json");

interface SyncOptions {
  platform: NodeJS.Platform;
  arch: string;
  app?: string;
  lock?: string;
}

interface Artifact {
  url: string;
  sha512: string;
}

interface RuntimeLock {
  schemaVersion: 1;
  appVersion: string;
  platform: string;
  arch: string;
  url: string;
  sha512: string;
}

function parseArgs(argv: string[]): SyncOptions {
  const result: SyncOptions = { platform: process.platform, arch: process.arch };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--app" && value) {
      result.app = value;
      index += 1;
    } else if (key === "--lock" && value) {
      result.lock = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${key}`);
    }
  }
  return result;
}

async function readLock(path = lockPath): Promise<RuntimeLock | undefined> {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as RuntimeLock;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.text();
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  const writer = Bun.file(destination).writer({ highWaterMark: 1024 * 1024 });
  try {
    for await (const chunk of response.body) await writer.write(chunk);
  } finally {
    await writer.end();
  }
}

async function sha512Base64(path: string): Promise<string> {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("base64");
}

async function run(command: string, args: string[], options: { cwd?: string; capture?: boolean } = {}): Promise<string> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    stdin: "inherit",
    stdout: options.capture ? "pipe" : "inherit",
    stderr: "inherit"
  });
  const stdoutPromise = options.capture
    ? new Response(child.stdout as ReadableStream<Uint8Array>).text()
    : Promise.resolve("");
  const [code, stdout] = await Promise.all([child.exited, stdoutPromise]);
  if (code !== 0) throw new Error(`${command} exited with status ${code}`);
  return stdout.trim();
}

async function findFile(directory: string, name: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const match = await findFile(path, name);
      if (match) return match;
    }
  }
  return null;
}

async function extractWith7Zip(archive: string, output: string, platform: string): Promise<string> {
  const first = join(output, "stage-1");
  await mkdir(first, { recursive: true });
  await run("7z", ["x", archive, `-o${first}`, "-y"]);
  if (platform === "linux") {
    const compressedTar = await findFile(first, "data.tar.xz");
    if (!compressedTar) throw new Error("Linux package does not contain data.tar.xz.");
    const second = join(output, "stage-2");
    const third = join(output, "root");
    await mkdir(second, { recursive: true });
    await mkdir(third, { recursive: true });
    await run("7z", ["x", compressedTar, `-o${second}`, "-y"]);
    const tar = await findFile(second, "data.tar");
    if (!tar) throw new Error("Could not unpack data.tar.xz.");
    await run("7z", ["x", tar, `-o${third}`, "-y"]);
    return third;
  }
  if (platform === "win32") {
    const appArchive = await findFile(first, "app-64.7z");
    if (!appArchive) throw new Error("Windows installer does not contain app-64.7z.");
    const second = join(output, "root");
    await mkdir(second, { recursive: true });
    await run("7z", ["x", appArchive, `-o${second}`, "-y"]);
    return second;
  }
  return first;
}

interface RuntimeSource {
  appVersion: string;
  glm: string;
  lock?: RuntimeLock;
  source: string;
}

async function getLocalAppVersion(app: string): Promise<string> {
  return await run(
    "plutil",
    ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", join(app, "Contents", "Info.plist")],
    { capture: true }
  );
}

async function resolveLockedSource(lock: RuntimeLock, temporaryDirectory: string): Promise<RuntimeSource> {
  const archiveName = basename(new URL(lock.url).pathname) || "zcode-installer";
  const archive = join(temporaryDirectory, archiveName);
  console.log(`Downloading ${lock.url}`);
  await download(lock.url, archive);
  const actualHash = await sha512Base64(archive);
  if (actualHash !== lock.sha512) {
    throw new Error(
      `Downloaded installer failed SHA-512 verification.\n`
      + `  lock:   ${lock.sha512}\n`
      + `  actual: ${actualHash}`
    );
  }
  const extracted = await extractWith7Zip(archive, join(temporaryDirectory, "extract"), lock.platform);
  const runtime = await findFile(extracted, "zcode.cjs");
  if (!runtime || basename(dirname(runtime)) !== "glm") {
    throw new Error("Could not locate resources/glm/zcode.cjs.");
  }
  return { appVersion: lock.appVersion, glm: dirname(runtime), lock, source: lock.url };
}

async function resolveSource(options: SyncOptions, temporaryDirectory: string): Promise<RuntimeSource> {
  if (options.app) {
    const app = resolve(options.app);
    const glm = join(app, "Contents", "Resources", "glm");
    if (!existsSync(join(glm, "zcode.cjs"))) throw new Error(`No ZCode runtime found in ${app}`);
    const existingLock = await readLock();
    return {
      appVersion: await getLocalAppVersion(app),
      glm,
      lock: existingLock,
      source: app
    };
  }

  const lock = options.lock
    ? JSON.parse(await readFile(resolve(root, options.lock), "utf8")) as RuntimeLock
    : await readLock();
  if (!lock) {
    throw new Error(
      "No zcode-runtime.lock.json. Copy the lock from zcode-cli for the same upstream version, "
      + "or run with --app /Applications/ZCode.app."
    );
  }
  return await resolveLockedSource(lock, temporaryDirectory);
}

async function sync(options: SyncOptions): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "zcode-vsce-sync-"));
  const nextVendor = join(root, ".vendor-next");
  try {
    const source = await resolveSource(options, temporaryDirectory);
    await rm(nextVendor, { recursive: true, force: true });
    await cp(source.glm, nextVendor, { recursive: true });

    const node = process.env.ZCODE_NODE || Bun.which("node");
    if (!node) throw new Error("Node.js >=22.19 is required to validate the official ZCode runtime.");
    const cliVersion = await run(node, [join(nextVendor, "zcode.cjs"), "--version"], { capture: true });
    await writeFile(join(nextVendor, "extraction.json"), `${JSON.stringify({
      appVersion: source.appVersion,
      cliVersion,
      extractedAt: new Date().toISOString(),
      ...(source.lock ? { sha512: source.lock.sha512 } : {}),
      source: source.source
    }, null, 2)}\n`);

    if (!options.app && source.lock) {
      await writeFile(lockPath, `${JSON.stringify(source.lock, null, 2)}\n`);
    }
    await rm(join(root, "vendor"), { recursive: true, force: true });
    await rename(nextVendor, join(root, "vendor"));
    console.log(`Prepared vendor runtime (ZCode App ${source.appVersion}, ${cliVersion}).`);
  } finally {
    await rm(nextVendor, { recursive: true, force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    await sync(parseArgs(process.argv.slice(2)));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

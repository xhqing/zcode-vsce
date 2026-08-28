#!/usr/bin/env node
/**
 * Build script: bundles the extension host entry (CommonJS-ish ESM fine for
 * VSCode) and the webview IIFE, copies static webview assets.
 */

import { build, context } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production") || !watch;

const common = {
  bundle: true,
  sourcemap: watch ? "inline" : false,
  minify: production,
  logLevel: "info",
  target: ["node22", "chrome120"],
  format: "esm"
};

const extension = {
  ...common,
  entryPoints: [join(root, "src", "extension.ts")],
  outfile: join(root, "out", "extension.js"),
  platform: "node",
  external: ["vscode"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }
};

const webview = {
  ...common,
  entryPoints: [join(root, "webview", "main.ts")],
  outfile: join(root, "out", "webview", "main.js"),
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") }
};

async function copyAssets() {
  await mkdir(join(root, "out", "webview"), { recursive: true });
  await cp(join(root, "webview", "main.css"), join(root, "out", "webview", "main.css"));
}

if (watch) {
  const extensionContext = await context(extension);
  const webviewContext = await context(webview);
  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
  await copyAssets();
} else {
  await build(extension);
  await build(webview);
  await copyAssets();
}

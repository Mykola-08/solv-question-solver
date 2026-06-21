#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const outDir = join(root, "dist");
const zipName = `solv-${manifest.version}.zip`;
const zipPath = join(outDir, zipName);

const files = [
  "manifest.json",
  "background.js",
  "providers.js",
  "config.js",
  "ui.css",
  "content.js",
  "content.css",
  "builtin-ai.js",
  "web-driver.js",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js",
  "sidepanel.html",
  "sidepanel.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync("zip", ["-X", "-q", zipPath, ...files], { cwd: root, stdio: "inherit" });

console.log(`Created ${join("dist", basename(zipPath))}`);

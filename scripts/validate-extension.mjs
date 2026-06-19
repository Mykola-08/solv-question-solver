#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const errors = [];
const warnings = [];
const ok = [];

const rel = (p) => join(root, p);
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const pass = (msg) => ok.push(msg);
const readJson = (p) => JSON.parse(readFileSync(rel(p), "utf8"));

function walk(dir, out = []) {
  for (const name of readdirSync(rel(dir))) {
    const p = `${dir}/${name}`;
    if ([".git", "dist", "node_modules"].includes(name)) continue;
    const s = statSync(rel(p));
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function checkExists(path, label = path) {
  if (!existsSync(rel(path))) fail(`${label} is referenced but missing: ${path}`);
  else pass(`${label} exists`);
}

function pngSize(path) {
  const buf = readFileSync(rel(path));
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let manifest;
try {
  manifest = readJson("manifest.json");
  pass("manifest.json parses");
} catch (e) {
  fail(`manifest.json does not parse: ${e.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
  if (!manifest.name || !manifest.description || !manifest.version) fail("manifest needs name, description, and version");
  if (!manifest.minimum_chrome_version) warn("minimum_chrome_version is not set");

  checkExists(manifest.background?.service_worker || "", "background service worker");
  checkExists(manifest.action?.default_popup || "", "default popup");
  checkExists(manifest.options_page || "", "options page");
  checkExists(manifest.side_panel?.default_path || "", "side panel");

  for (const size of ["16", "48", "128"]) {
    const icon = manifest.icons?.[size] || manifest.action?.default_icon?.[size];
    checkExists(icon, `${size}px icon`);
    if (icon && existsSync(rel(icon))) {
      try {
        const actual = pngSize(icon);
        if (actual.width !== Number(size) || actual.height !== Number(size)) fail(`${icon} is ${actual.width}x${actual.height}, expected ${size}x${size}`);
      } catch (e) {
        fail(`${icon} is not a valid PNG: ${e.message}`);
      }
    }
  }

  for (const cs of manifest.content_scripts || []) {
    for (const js of cs.js || []) checkExists(js, "content script");
    for (const css of cs.css || []) checkExists(css, "content stylesheet");
  }
  for (const group of manifest.web_accessible_resources || []) {
    for (const resource of group.resources || []) checkExists(resource, "web accessible resource");
  }

  const listing = existsSync(rel("store/listing.md")) ? readFileSync(rel("store/listing.md"), "utf8") : "";
  for (const permission of manifest.permissions || []) {
    if (!listing.includes(`\`${permission}\``)) warn(`store/listing.md does not justify permission: ${permission}`);
  }
}

for (const file of walk(".")) {
  if (extname(file) === ".js" || extname(file) === ".mjs") {
    try {
      execFileSync("node", ["--check", rel(file)], { stdio: "pipe" });
    } catch (e) {
      fail(`JS syntax failed for ${file}: ${String(e.stderr || e.message).trim()}`);
    }
  }

  if ([".html", ".js", ".mjs"].includes(extname(file))) {
    const text = readFileSync(rel(file), "utf8");
    if (/<script[^>]+src=["']https?:\/\//i.test(text)) fail(`Remote script found in ${file}`);
    if (/\b(eval|new Function)\s*\(/.test(text)) fail(`Dynamic code execution pattern found in ${file}`);
  }
}

for (const required of ["store/listing.md", "store/privacy.md", "store/review-notes.md", "store/assets/README.md", "QA.md", "scripts/package-extension.mjs"]) {
  checkExists(required);
}

for (const line of ok) console.log(`ok: ${line}`);
for (const line of warnings) console.warn(`warn: ${line}`);
if (errors.length) {
  for (const line of errors) console.error(`error: ${line}`);
  process.exit(1);
}
console.log(`\nValidation passed with ${warnings.length} warning(s).`);

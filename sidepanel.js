// sidepanel.js — chat-style assistant. Reuses SOLV config + render helpers.
const SOLV = globalThis.SOLV;
const $ = (id) => document.getElementById(id);
const R = SOLV.render;
const esc = R.escapeHtml;
const escAttr = (s = "") => esc(String(s)).replace(/"/g, "&quot;");

let settings = null;
let mode = "short";
let attached = null; // dataURL
const history = []; // {role, content} for context
const MAX_STORED_IMAGE = 4_000_000;
const isImageDataUrl = (url) => /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(url || "") && url.length <= MAX_STORED_IMAGE;

async function load() {
  settings = await new Promise((res) => chrome.runtime.sendMessage({ type: "getSettings" }, res));
  mode = settings.defaultMode || "short";
  buildProvider(); buildModel(); buildModes(); updateHint();
  updateEmptySetupCue();
  syncSidePanelLayout();
  watchHandoff();
}

async function syncSidePanelLayout() {
  try {
    const layout = await chrome.sidePanel?.getLayout?.({});
    document.body.classList.toggle("sidepanel-left", layout?.side === "left");
    document.body.classList.toggle("sidepanel-right", layout?.side === "right");
  } catch {}
}

// ---------- delegation from the floating overlay ----------
let lastHandoffTs = 0;
function restoreHandoff(h) {
  if (!h || h.ts === lastHandoffTs) return;        // dedupe the same hand-off
  if (Date.now() - (h.ts || 0) > 5 * 60 * 1000) return; // ignore stale
  lastHandoffTs = h.ts;
  if (h.provider) { settings.provider = h.provider; buildProvider(); buildModel(); updateHint(); }
  if (h.model && !SOLV.WEB_PROVIDERS.has(settings.provider)) { settings.models = { ...settings.models, [settings.provider]: h.model }; buildModel(); }
  if (h.mode) { mode = h.mode; buildModes(); }
  if (h.question || h.image || h.answer) {
    $("empty")?.remove();
    addUser(h.question || "Image question", isImageDataUrl(h.image) ? h.image : null);
    if (h.answer) { const card = addAnswerCard(); finalizeCard(card, h.answer, true); }
    for (const m of (h.messages || [])) if (m.role !== "system") history.push(m);
    // brief banner so it's clear the conversation moved here
    const note = document.createElement("div");
    note.className = "msg"; note.innerHTML = `<div class="status" style="text-align:center">Continued from the page. Ask a follow-up below.</div>`;
    $("convo").appendChild(note); scroll();
    chrome.storage.local.remove("solvHandoff");
    if (h.imageOmitted) addError({ title: "Image was too large to hand off", steps: ["Ask a text follow-up here, or capture a smaller region on the page."] });
  }
}
function checkHandoff() {
  chrome.storage.local.get("solvHandoff").then(({ solvHandoff }) => { if (solvHandoff) restoreHandoff(solvHandoff); });
}
function watchHandoff() {
  checkHandoff();                                  // fresh open
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.solvHandoff?.newValue) restoreHandoff(ch.solvHandoff.newValue); }); // already open
  window.addEventListener("focus", checkHandoff);  // re-check when the panel gains focus
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkHandoff(); });
}

function buildProvider() {
  const allow = settings.visibleProviders || [];
  $("provider").innerHTML = SOLV.PROVIDER_GROUPS.map((g) => {
    const items = g.items.filter((p) => !allow.length || allow.includes(p) || p === settings.provider);
    return items.length ? `<optgroup label="${escAttr(g.label)}">` +
      items.map((p) => `<option value="${escAttr(p)}"${p === settings.provider ? " selected" : ""}>${esc(SOLV.PROVIDER_LABELS[p])}</option>`).join("") +
      `</optgroup>` : "";
  }).join("");
  $("provider").onchange = (e) => { settings.provider = e.target.value; save(); buildModel(); updateHint(); updateEmptySetupCue(); };
}
function buildModel() {
  const p = settings.provider, sel = $("model"), list = SOLV.MODELS[p] || [];
  if (SOLV.WEB_PROVIDERS.has(p)) { sel.innerHTML = `<option>model set in the site</option>`; sel.disabled = true; return; }
  sel.disabled = false;
  const cur = settings.models?.[p] || SOLV.DEFAULT_MODELS[p];
  const ids = list.map((m) => m.id);
  let html = list.map((m) => `<option value="${escAttr(m.id)}"${m.id === cur ? " selected" : ""}>${esc(m.label)}</option>`).join("");
  if (!ids.includes(cur)) html = `<option value="${escAttr(cur)}" selected>${esc(cur)} (custom)</option>` + html;
  sel.innerHTML = html;
  sel.onchange = (e) => { settings.models = { ...settings.models, [p]: e.target.value }; save(); };
}
function buildModes() {
  const allow = settings.visibleModes || [];
  const modes = SOLV.MODES.filter((m) => !allow.length || allow.includes(m.id));
  if (!modes.some((m) => m.id === mode)) mode = (modes[0] || SOLV.MODES[0]).id;
  $("modes").innerHTML = modes.map((m) => `<button class="mode${m.id === mode ? " on" : ""}" data-mode="${escAttr(m.id)}" title="${escAttr(m.desc)}">${esc(m.label)}</button>`).join("");
  $("modes").querySelectorAll(".mode").forEach((b) => b.onclick = () => {
    mode = b.dataset.mode; $("modes").querySelectorAll(".mode").forEach((x) => x.classList.toggle("on", x === b));
  });
}
function updateHint() {
  const p = settings.provider;
  $("hint").textContent = SOLV.WEB_PROVIDERS.has(p)
    ? `Uses your logged-in ${SOLV.PROVIDER_LABELS[p].split(" ")[0]} tab. Keep it open and signed in. Image upload is best-effort.`
    : settings.keys?.[p] || !["openai", "anthropic", "gemini"].includes(p)
      ? (SOLV.VISION_PROVIDERS.has(p) ? "Tip: attach or paste an image for diagram/handwriting questions." : "")
      : "Add and test this provider in Settings before solving.";
}
function updateEmptySetupCue() {
  const el = $("emptyHint");
  if (!el || !settings) return;
  const p = settings.provider;
  const needsKey = ["openai", "anthropic", "gemini"].includes(p) && !settings.keys?.[p];
  el.textContent = needsKey
    ? `${SOLV.PROVIDER_LABELS[p]} is selected. Add and test its key in Settings, or switch to a login/local provider.`
    : "Ask here, paste a screenshot, attach an image, or solve selected text on any page.";
}
const save = () => chrome.storage.local.set({ settings });
$("gear").onclick = () => chrome.runtime.openOptionsPage();

// ---------- attachments ----------
$("attach").onclick = () => $("file").click();
$("file").onchange = (e) => { const f = e.target.files[0]; if (f) fileToDataUrl(f).then(setAttached); };
$("input").addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) { const f = item.getAsFile(); if (f) { e.preventDefault(); fileToDataUrl(f).then(setAttached); } }
});
function fileToDataUrl(file) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); }); }
function normalizeImageDataUrl(url) {
  return new Promise((resolve, reject) => {
    if (!/^data:image\//i.test(url || "")) { reject(new Error("Unsupported image file.")); return; }
    const img = new Image();
    img.onload = () => {
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = url;
  });
}
async function setAttached(url) {
  let normalized;
  try {
    normalized = await normalizeImageDataUrl(url);
  } catch (e) {
    addError({ title: "Image is too large or unsupported", steps: ["Use PNG, JPEG, WebP, or GIF.", "Capture a smaller region or attach a smaller file."] });
    return;
  }
  if (!isImageDataUrl(normalized)) {
    addError({ title: "Image is too large or unsupported", steps: ["Capture a smaller region or attach a smaller file.", "Try a simpler crop around just the question."] });
    return;
  }
  attached = normalized;
  $("attachWrap").innerHTML = `<span class="attach-chip"><img src="${normalized}" alt="Attached image preview"/> image attached <button id="rm" aria-label="Remove attached image">✕</button></span>`;
  $("rm").onclick = () => { attached = null; $("attachWrap").innerHTML = ""; };
}

// ---------- input box ----------
const input = $("input");
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
    e.preventDefault();
    send();
  }
});
$("send").onclick = send;

// ---------- transport ----------
async function dataUrlToImageValue(dataUrl) {
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(dataUrl || "")) {
    throw new Error("Invalid image data. Capture or attach the image again.");
  }
  if (dataUrl.length > 12_000_000) throw new Error("Image is too large. Capture a smaller region or use a smaller file.");
  const blob = await (await fetch(dataUrl)).blob();
  if (typeof createImageBitmap === "function") return await createImageBitmap(blob);
  return blob;
}
function builtinLocal(messages, image, onToken, signal) {
  return new Promise(async (resolve, reject) => {
    const API = (typeof LanguageModel !== "undefined") ? LanguageModel : globalThis.ai?.languageModel;
    if (!API) return reject(new Error("Chrome built-in AI isn't available. Enable the Prompt API / Gemini Nano in a recent Chrome, then reload Solv."));
    try {
      const sys = messages.find((m) => m.role === "system")?.content;
      const user = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      const modelOpts = {
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        ...(image ? { expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }] } : {})
      };
      const opts = {
        ...modelOpts,
        ...(sys ? { initialPrompts: [{ role: "system", content: sys }] } : {}),
        ...(signal ? { signal } : {})
      };
      let availability = "available";
      try {
        if (typeof API.availability === "function") availability = await API.availability(modelOpts);
      } catch {}
      if (availability === "unavailable" || availability === "no") throw new Error("Gemini Nano is unavailable on this device.");
      if (availability === "downloadable" || availability === "downloading" || availability === "after-download") onToken("(downloading on-device model — first run can take a minute)\n\n");
      opts.monitor = (monitor) => {
        monitor.addEventListener?.("downloadprogress", (e) => {
          if (Number.isFinite(e.loaded)) onToken(`(model download ${Math.round(e.loaded * 100)}%)\n`);
        });
      };
      const s = await API.create(opts);
      let promptInput = user;
      if (image) {
        const img = await dataUrlToImageValue(image);
        promptInput = [{ role: "user", content: [
          { type: "text", value: user || "Solve the question in this image." },
          { type: "image", value: img }
        ] }];
      }
      let prev = "";
      for await (const ch of s.promptStreaming(promptInput)) { if (ch.startsWith(prev) && prev) { onToken(ch.slice(prev.length)); prev = ch; } else { onToken(ch); prev += ch; } }
      s.destroy?.(); resolve();
    } catch (e) { reject(e); }
  });
}
function runSolve({ messages, image, onToken, signal }) {
  if (settings.provider === "builtin") return builtinLocal(messages, image, onToken, signal);
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "solv-stream" });
    let settled = false, gotToken = false;
    const fin = (fn, a) => { if (settled) return; settled = true; try { port.disconnect(); } catch {} fn(a); };
    signal?.addEventListener("abort", () => fin(reject, new Error("aborted")), { once: true });
    port.onMessage.addListener((m) => {
      if (m.type === "token") { gotToken = true; onToken(m.text); }
      else if (m.type === "ping") { /* keepalive */ }
      else if (m.type === "done") fin(resolve);
      else if (m.type === "error") fin(reject, new Error(m.error));
    });
    port.onDisconnect.addListener(() => fin(gotToken ? resolve : reject, gotToken ? undefined : new Error("The connection dropped before any answer arrived. Press send again.")));
    port.postMessage({ type: "solve", payload: { provider: settings.provider, model: settings.models?.[settings.provider], messages, image } });
  });
}

// ---------- send / render ----------
let busy = false;
async function send() {
  const text = input.value.trim();
  if ((!text && !attached) || busy) return;
  if (!hasCreds()) { addError({ title: `Add a key for ${SOLV.PROVIDER_LABELS[settings.provider]}`, steps: ["Open Settings (⚙) and paste your API key.", "Or switch to a login / Ollama / Chrome AI provider."], action: "options" }); return; }

  $("empty")?.remove();
  chrome.storage.local.remove("solvHandoff"); // consumed — don't replay on reopen
  const image = attached; const qtext = text || "Solve the question in this image.";
  addUser(qtext, image);
  input.value = ""; input.style.height = "auto";
  attached = null; $("attachWrap").innerHTML = "";

  const messages = [{ role: "system", content: SOLV.buildSystem(mode, settings.modePrompts) }, ...history, { role: "user", content: qtext }];
  const card = addAnswerCard();
  busy = true; $("send").disabled = true;
  let acc = "";
  const controller = new AbortController();
  try {
    await runSolve({ messages, image, signal: controller.signal, onToken: (t) => { acc += t; card.live.innerHTML = R.md(R.stripConfidence(acc)); scroll(); } });
    history.push({ role: "user", content: qtext }, { role: "assistant", content: acc });
    finalizeCard(card, acc, false, { image, question: qtext });
  } catch (e) {
    card.wrap.remove();
    addError(SOLV.friendlyError(String(e.message || e), settings.provider));
  } finally { busy = false; $("send").disabled = false; scroll(); }
}

function addUser(text, image) {
  const d = document.createElement("div");
  d.className = "msg";
  d.innerHTML = `<div class="bubble-user">${R.escapeHtml(text)}${image ? `<img src="${image}"/>` : ""}</div>`;
  $("convo").appendChild(d); scroll();
}
function addAnswerCard() {
  const wrap = document.createElement("div");
  wrap.className = "msg";
  wrap.innerHTML = `<div class="ans">
    <div class="final" hidden></div>
    <div class="live"></div>
    <div class="verify"></div>
    <div class="status"><span class="dots"><i></i><i></i><i></i></span> ${SOLV.WEB_PROVIDERS.has(settings.provider) ? "using your logged-in session…" : "thinking…"}</div>
  </div>`;
  $("convo").appendChild(wrap);
  return { wrap, final: wrap.querySelector(".final"), live: wrap.querySelector(".live"), status: wrap.querySelector(".status"), verify: wrap.querySelector(".verify") };
}
const confBadge = (c) => c == null ? "" : `<span class="cbadge" data-tone="${R.confTone(c)}">${c}%</span>`;
function finalizeCard(card, acc, skipVerify, context = {}) {
  card.status.textContent = "";
  const r = R.parseResult(acc);
  const hint = mode === "hint";
  const label = hint ? "Hint" : r.choice ? "Correct choice" : "Answer";
  const core = r.choice
    ? `<div class="choice"><div class="cbadge-letter">${r.choice}</div><div class="txt">${r.choiceText ? R.md(r.choiceText) : ""}</div></div>`
    : `<div class="txt">${R.md(r.answer)}</div>`;
  card.final.hidden = false;
  card.final.innerHTML = `<div class="fhead"><span class="lab">${esc(label)}</span>${confBadge(r.confidence)}</div>${core}
    <div class="meta">${esc(SOLV.PROVIDER_LABELS[settings.provider])} · ${esc(SOLV.WEB_PROVIDERS.has(settings.provider) ? "your model" : (settings.models?.[settings.provider] || SOLV.DEFAULT_MODELS[settings.provider]))}</div>`;
  card.live.innerHTML = r.rest ? `<details class="reason"${r.rest.length < 260 ? " open" : ""}><summary>Show reasoning</summary><div class="reason-body">${R.md(r.rest)}</div></details>` : "";
  const actions = document.createElement("div");
  actions.className = "ans-actions";
  actions.innerHTML = `
    <button class="ans-act" title="Copy answer" aria-label="Copy answer">⧉</button>
    <button class="ans-act" title="Double-check independently" aria-label="Double-check independently">✓✓</button>`;
  card.live.appendChild(actions);
  const [copyBtn, verifyBtn] = actions.querySelectorAll("button");
  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(R.stripConfidence(acc));
    const old = copyBtn.textContent;
    copyBtn.textContent = "✓";
    setTimeout(() => (copyBtn.textContent = old), 1200);
  });
  verifyBtn.addEventListener("click", () => verify(card, acc, context));
  if (!skipVerify && r.confidence != null && settings.autoVerify && r.confidence < (settings.confidenceThreshold ?? 70)) verify(card, acc, context);
}
async function verify(card, original, context = {}) {
  const v = card.verify;
  v.innerHTML = `<span class="dots"><i></i><i></i><i></i></span> verifying independently…`;
  let second = "";
  try {
    await runSolve({
      messages: [{ role: "system", content: SOLV.buildSystem("steps", settings.modePrompts) },
        { role: "user", content: context.question || history[history.length - 2]?.content || "" },
        { role: "user", content: "Solve this independently from scratch; double-check the arithmetic." }],
      image: context.image || null, onToken: (t) => { second += t; }
    });
    const norm = (s) => R.stripConfidence(s).split("\n").map((l) => l.trim()).filter(Boolean)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    const agree = norm(original) && norm(original) === norm(second);
    v.innerHTML = agree ? `<span class="badge good">✓ Verified — attempts agree</span>`
      : `<span class="badge bad">⚠ Attempts disagree — review</span><div class="reason-body" style="margin-top:6px">${R.md(R.stripConfidence(second))}</div>`;
  } catch (e) { v.innerHTML = `<span class="status">verify failed.</span>`; }
}
function addError(help) {
  $("empty")?.remove();
  const d = document.createElement("div"); d.className = "msg";
  const steps = (help.steps || []).map((s) => `<li>${R.escapeHtml(s)}</li>`).join("");
  d.innerHTML = `<div class="err"><div class="t">⚠ ${R.escapeHtml(help.title || "Error")}</div><ol>${steps}</ol>
    <div class="row">${help.action === "options" ? `<button class="mode" id="eopts">Open settings</button>` : ""}</div></div>`;
  $("convo").appendChild(d);
  d.querySelector("#eopts")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  scroll();
}
const hasCreds = () => settings.provider === "openai" ? !!settings.keys.openai : settings.provider === "anthropic" ? !!settings.keys.anthropic : settings.provider === "gemini" ? !!settings.keys.gemini : true;
const scroll = () => { const c = $("convo"); c.scrollTop = c.scrollHeight; };

load();

// sidepanel.js — chat-style assistant. Reuses SOLV config + render helpers.
const SOLV = globalThis.SOLV;
const $ = (id) => document.getElementById(id);
const R = SOLV.render;

let settings = null;
let mode = "short";
let attached = null; // dataURL
const history = []; // {role, content} for context

async function load() {
  settings = await new Promise((res) => chrome.runtime.sendMessage({ type: "getSettings" }, res));
  mode = settings.defaultMode || "short";
  buildProvider(); buildModel(); buildModes(); updateHint();
  watchHandoff();
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
    addUser(h.question || "Image question", h.image || null);
    if (h.answer) { const card = addAnswerCard(); finalizeCard(card, h.answer, true); }
    for (const m of (h.messages || [])) if (m.role !== "system") history.push(m);
    // brief banner so it's clear the conversation moved here
    const note = document.createElement("div");
    note.className = "msg"; note.innerHTML = `<div class="status" style="text-align:center">↳ continued from the page — ask a follow-up below</div>`;
    $("convo").appendChild(note); scroll();
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
    return items.length ? `<optgroup label="${g.label}">` +
      items.map((p) => `<option value="${p}"${p === settings.provider ? " selected" : ""}>${SOLV.PROVIDER_LABELS[p]}</option>`).join("") +
      `</optgroup>` : "";
  }).join("");
  $("provider").onchange = (e) => { settings.provider = e.target.value; save(); buildModel(); updateHint(); };
}
function buildModel() {
  const p = settings.provider, sel = $("model"), list = SOLV.MODELS[p] || [];
  if (SOLV.WEB_PROVIDERS.has(p)) { sel.innerHTML = `<option>model set in the site</option>`; sel.disabled = true; return; }
  sel.disabled = false;
  const cur = settings.models?.[p] || SOLV.DEFAULT_MODELS[p];
  const ids = list.map((m) => m.id);
  let html = list.map((m) => `<option value="${m.id}"${m.id === cur ? " selected" : ""}>${m.label}</option>`).join("");
  if (!ids.includes(cur)) html = `<option value="${cur}" selected>${cur} (custom)</option>` + html;
  sel.innerHTML = html;
  sel.onchange = (e) => { settings.models = { ...settings.models, [p]: e.target.value }; save(); };
}
function buildModes() {
  const allow = settings.visibleModes || [];
  const modes = SOLV.MODES.filter((m) => !allow.length || allow.includes(m.id));
  if (!modes.some((m) => m.id === mode)) mode = (modes[0] || SOLV.MODES[0]).id;
  $("modes").innerHTML = modes.map((m) => `<button class="mode${m.id === mode ? " on" : ""}" data-mode="${m.id}" title="${m.desc}">${m.label}</button>`).join("");
  $("modes").querySelectorAll(".mode").forEach((b) => b.onclick = () => {
    mode = b.dataset.mode; $("modes").querySelectorAll(".mode").forEach((x) => x.classList.toggle("on", x === b));
  });
}
function updateHint() {
  const p = settings.provider;
  $("hint").innerHTML = SOLV.WEB_PROVIDERS.has(p)
    ? `Uses your logged-in ${SOLV.PROVIDER_LABELS[p].split(" ")[0]} tab. Keep it open & signed in. (Text only.)`
    : SOLV.VISION_PROVIDERS.has(p) ? "Tip: attach or paste an image for diagram/handwriting questions." : "";
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
function setAttached(url) {
  attached = url;
  $("attachWrap").innerHTML = `<span class="attach-chip"><img src="${url}"/> image attached <button id="rm">✕</button></span>`;
  $("rm").onclick = () => { attached = null; $("attachWrap").innerHTML = ""; };
}

// ---------- input box ----------
const input = $("input");
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
$("send").onclick = send;

// ---------- transport ----------
function builtinLocal(messages, image, onToken) {
  return new Promise(async (resolve, reject) => {
    const API = (typeof LanguageModel !== "undefined") ? LanguageModel : globalThis.ai?.languageModel;
    if (!API) return reject(new Error("Chrome built-in AI isn't available in the side panel — use the in-page overlay for Gemini Nano, or pick another provider."));
    try {
      const sys = messages.find((m) => m.role === "system")?.content;
      const user = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      const opts = sys ? { initialPrompts: [{ role: "system", content: sys }] } : {};
      const s = await API.create(opts);
      let prev = "";
      for await (const ch of s.promptStreaming(user)) { if (ch.startsWith(prev) && prev) { onToken(ch.slice(prev.length)); prev = ch; } else { onToken(ch); prev += ch; } }
      s.destroy?.(); resolve();
    } catch (e) { reject(e); }
  });
}
function runSolve({ messages, image, onToken }) {
  if (settings.provider === "builtin") return builtinLocal(messages, image, onToken);
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "solv-stream" });
    let settled = false, gotToken = false;
    const fin = (fn, a) => { if (settled) return; settled = true; try { port.disconnect(); } catch {} fn(a); };
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
  if (attached && SOLV.WEB_PROVIDERS.has(settings.provider)) {
    addError({ title: "Login providers can't read images", steps: ["Switch to OpenAI / Claude / Gemini (API) or a local vision model.", "Then resend with the image attached."] });
    return;
  }
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
  try {
    await runSolve({ messages, image, onToken: (t) => { acc += t; card.live.innerHTML = R.md(R.stripConfidence(acc)); scroll(); } });
    history.push({ role: "user", content: qtext }, { role: "assistant", content: acc });
    finalizeCard(card, acc);
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
    <div class="status"><span class="dots"><i></i><i></i><i></i></span> ${SOLV.WEB_PROVIDERS.has(settings.provider) ? "asking your logged-in session…" : "thinking…"}</div>
  </div>`;
  $("convo").appendChild(wrap);
  return { wrap, final: wrap.querySelector(".final"), live: wrap.querySelector(".live"), status: wrap.querySelector(".status"), verify: wrap.querySelector(".verify") };
}
const confBadge = (c) => c == null ? "" : `<span class="cbadge" data-tone="${R.confTone(c)}">${c}%</span>`;
function finalizeCard(card, acc, skipVerify) {
  card.status.textContent = "";
  const r = R.parseResult(acc);
  const hint = mode === "hint";
  const label = hint ? "Hint" : r.choice ? "Correct choice" : "Answer";
  const core = r.choice
    ? `<div class="choice"><div class="cbadge-letter">${r.choice}</div><div class="txt">${r.choiceText ? R.md(r.choiceText) : ""}</div></div>`
    : `<div class="txt">${R.md(r.answer)}</div>`;
  card.final.hidden = false;
  card.final.innerHTML = `<div class="fhead"><span class="lab">${label}</span>${confBadge(r.confidence)}</div>${core}
    <div class="meta">${SOLV.PROVIDER_LABELS[settings.provider]} · ${SOLV.WEB_PROVIDERS.has(settings.provider) ? "your model" : (settings.models?.[settings.provider] || SOLV.DEFAULT_MODELS[settings.provider])}</div>`;
  card.live.innerHTML = r.rest ? `<details class="reason"${r.rest.length < 260 ? " open" : ""}><summary>Show reasoning</summary><div class="reason-body">${R.md(r.rest)}</div></details>` : "";
  if (!skipVerify && r.confidence != null && settings.autoVerify && r.confidence < (settings.confidenceThreshold ?? 70)) verify(card, acc);
}
async function verify(card, original) {
  const v = card.verify;
  v.innerHTML = `<span class="dots"><i></i><i></i><i></i></span> verifying independently…`;
  let second = "";
  try {
    await runSolve({
      messages: [{ role: "system", content: SOLV.buildSystem("steps", settings.modePrompts) },
        { role: "user", content: history[history.length - 2]?.content || "" },
        { role: "user", content: "Solve this independently from scratch; double-check the arithmetic." }],
      image: null, onToken: (t) => { second += t; }
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

// content.js — Solv in-page UI: selection pill, region capture, answer overlay.
(() => {
  if (window.__solvLoaded) return;
  window.__solvLoaded = true;
  const SOLV = globalThis.SOLV;
  const R = SOLV.render;
  const escapeHtml = R.escapeHtml;
  const escapeAttr = (s = "") => escapeHtml(String(s)).replace(/"/g, "&quot;");
  const renderMd = R.md;
  const parseConfidence = R.parseConfidence;
  const stripConfidence = R.stripConfidence;

  let settings = null;
  const getSettings = () =>
    new Promise((res) => chrome.runtime.sendMessage({ type: "getSettings" }, (s) => res(s)));
  const saveSettings = () => chrome.storage.local.set({ settings });
  const modelFor = (p) => settings.models?.[p] || SOLV.DEFAULT_MODELS[p];

  // ---------- built-in AI bridge ----------
  let builtinReady = false;
  function ensureBuiltinBridge() {
    if (builtinReady) return;
    builtinReady = true;
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("builtin-ai.js");
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }
  function builtinSolve(messages, image, onToken, signal) {
    ensureBuiltinBridge();
    return new Promise((resolve, reject) => {
      const id = "b" + Math.random().toString(36).slice(2);
      const handler = (ev) => {
        const d = ev.data;
        if (!d || d.source !== "solv-builtin" || d.id !== id) return;
        if (d.type === "token") onToken(d.text);
        else if (d.type === "done") { window.removeEventListener("message", handler); resolve(); }
        else if (d.type === "error") { window.removeEventListener("message", handler); reject(new Error(d.error)); }
      };
      window.addEventListener("message", handler);
      signal?.addEventListener("abort", () => {
        window.removeEventListener("message", handler);
        reject(new Error("aborted"));
      }, { once: true });
      window.postMessage({ source: "solv", type: "builtin-solve", id, messages, image }, "*");
    });
  }

  // ---------- transport ----------
  function runSolve({ messages, image, onToken, signal }) {
    if (settings.provider === "builtin") return builtinSolve(messages, image, onToken, signal);
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "solv-stream" });
      let settled = false, gotToken = false;
      const finish = (fn, arg) => { if (settled) return; settled = true; try { port.disconnect(); } catch {} fn(arg); };
      signal?.addEventListener("abort", () => finish(reject, new Error("aborted")), { once: true });
      port.onMessage.addListener((m) => {
        if (m.type === "token") { gotToken = true; onToken(m.text); }
        else if (m.type === "ping") { /* keepalive */ }
        else if (m.type === "done") finish(resolve);
        else if (m.type === "error") finish(reject, new Error(m.error));
      });
      // If the worker is recycled mid-stream, keep whatever streamed in rather than erroring out.
      port.onDisconnect.addListener(() => finish(gotToken ? resolve : reject, gotToken ? undefined : new Error("The connection dropped before any answer arrived. Press Retry.")));
      port.postMessage({ type: "solve", payload: { provider: settings.provider, model: modelFor(settings.provider), messages, image } });
    });
  }

  const firstLine = (t) => stripConfidence(t).split("\n").map((l) => l.trim()).filter(Boolean)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";

  // ---------- selection pill ----------
  let pill = null;
  const removePill = () => { pill?.remove(); pill = null; };
  function showPill(rect, text) {
    removePill();
    pill = document.createElement("div");
    pill.className = "solv-pill";
    pill.innerHTML = `<span class="solv-pill-glyph">S</span> Solve`;
    pill.style.top = `${window.scrollY + rect.bottom + 8}px`;
    pill.style.left = `${window.scrollX + rect.left}px`;
    pill.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); removePill(); solveText(text); });
    document.body.appendChild(pill);
  }
  document.addEventListener("mouseup", (e) => {
    if (e.target.closest && e.target.closest(".solv-root, .solv-pill, .solv-region")) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length > 1 && sel.rangeCount) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width || rect.height) showPill(rect, text);
      } else removePill();
    }, 10);
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest || !e.target.closest(".solv-pill")) removePill(); });

  // ---------- panel ----------
  let panel = null;
  const visibleProviders = () => {
    const v = settings.visibleProviders || [];
    return v.length ? v : null;
  };
  const visibleModes = () => {
    const v = settings.visibleModes || [];
    return SOLV.MODES.filter((m) => !v.length || v.includes(m.id));
  };
  function buildProviderOptions(current) {
    const allow = visibleProviders();
    return SOLV.PROVIDER_GROUPS.map((g) => {
      const items = g.items.filter((p) => !allow || allow.includes(p) || p === current);
      if (!items.length) return "";
      return `<optgroup label="${escapeAttr(g.label)}">` +
        items.map((p) => `<option value="${escapeAttr(p)}"${p === current ? " selected" : ""}>${escapeHtml(SOLV.PROVIDER_LABELS[p])}</option>`).join("") +
        `</optgroup>`;
    }).join("");
  }
  function applyOverlayPrefs() {
    const o = settings.overlay || {};
    const set = (sel, show) => { const el = panel.querySelector(sel); if (el) el.style.display = show ? "" : "none"; };
    set(".solv-model", o.showModel !== false);
    set(".solv-modes", o.showModes !== false);
    set(".solv-foot", o.showFollowup !== false);
    if (o.compact !== false) panel.classList.add("solv-compact"); else panel.classList.remove("solv-compact");
    syncControlsAccessibility();
  }
  function syncControlsAccessibility() {
    const controls = panel?.querySelector(".solv-controls");
    if (!controls) return;
    const hidden = panel.classList.contains("solv-compact") && !panel.classList.contains("solv-controls-open");
    controls.inert = hidden;
    controls.setAttribute("aria-hidden", hidden ? "true" : "false");
  }
  function refreshModelSelect() {
    const sel = panel.querySelector(".solv-model");
    const p = settings.provider;
    const list = SOLV.MODELS[p] || [];
    if (SOLV.WEB_PROVIDERS.has(p)) {
      sel.innerHTML = `<option>set in the site</option>`; sel.disabled = true; return;
    }
    sel.disabled = false;
    const cur = modelFor(p);
    const ids = list.map((m) => m.id);
    let html = list.map((m) => `<option value="${escapeAttr(m.id)}"${m.id === cur ? " selected" : ""}>${escapeHtml(m.label)}</option>`).join("");
    if (!ids.includes(cur)) html = `<option value="${escapeAttr(cur)}" selected>${escapeHtml(cur)} (custom)</option>` + html;
    sel.innerHTML = html;
  }
  function makePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "solv-root";
    panel.innerHTML = `
      <div class="solv-head">
        <div class="solv-brand"><span class="solv-logo">S</span> Solv</div>
        <div class="solv-head-actions">
          <button class="solv-icon solv-tune" title="Provider / model / mode" aria-label="Provider, model, and mode">⚙</button>
          <button class="solv-icon solv-side" title="Continue in side panel chat" aria-label="Continue in side panel chat">⇥</button>
          <button class="solv-icon solv-close" title="Close (Esc)" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="solv-controls">
        <div class="solv-tools">
          <select class="solv-select solv-provider" title="Provider">${buildProviderOptions(settings.provider)}</select>
          <select class="solv-select solv-model" title="Model"></select>
        </div>
        <div class="solv-modes" role="tablist">
          ${visibleModes().map((m) => `<button class="solv-mode${m.id === state.mode ? " is-on" : ""}" data-mode="${escapeAttr(m.id)}" title="${escapeAttr(m.desc)}">${escapeHtml(m.label)}</button>`).join("")}
        </div>
      </div>
      <div class="solv-body">
        <div class="solv-question"></div>
        <div class="solv-final" hidden></div>
        <div class="solv-answer"></div>
        <div class="solv-verify"></div>
        <div class="solv-status"></div>
        <div class="solv-actions" hidden>
          <button class="solv-act solv-copy" title="Copy answer" aria-label="Copy answer">⧉</button>
          <button class="solv-act solv-regen" title="Regenerate" aria-label="Regenerate answer">↻</button>
          <button class="solv-act solv-reverify" title="Double-check independently" aria-label="Double-check independently">✓✓</button>
        </div>
      </div>
      <div class="solv-foot">
        <input class="solv-followup" placeholder="Ask a follow-up…" />
        <button class="solv-send" title="Send" aria-label="Send follow-up">↑</button>
      </div>`;
    document.body.appendChild(panel);

    const closePanel = () => { abortCurrent(); panel?.remove(); panel = null; document.removeEventListener("keydown", onEsc); };
    const onEsc = (e) => {
      if (e.key === "Escape" && panel) {
        if (document.activeElement?.classList?.contains("solv-followup")) return; closePanel();
      }
    };
    document.addEventListener("keydown", onEsc);
    panel._close = closePanel;
    panel.querySelector(".solv-close").onclick = closePanel;
    panel.querySelector(".solv-tune").onclick = () => { panel.classList.toggle("solv-controls-open"); syncControlsAccessibility(); };
    panel.querySelector(".solv-side").onclick = () => delegateToSide();
    panel.querySelector(".solv-copy").onclick = () => { navigator.clipboard.writeText(stripConfidence(state.answer || "")); flash(panel.querySelector(".solv-copy"), "✓"); };
    panel.querySelector(".solv-reverify").onclick = () => verify(true);
    panel.querySelector(".solv-regen").onclick = () => { if (state.lastQuestion || state.lastImage) restart(); };
    const send = () => { const fuEl = panel.querySelector(".solv-followup"); if (fuEl.value.trim()) { const q = fuEl.value.trim(); fuEl.value = ""; followUp(q); } };
    panel.querySelector(".solv-send").onclick = send;
    panel.querySelector(".solv-provider").onchange = (e) => {
      settings.provider = e.target.value; saveSettings(); refreshModelSelect();
      if (state.lastQuestion || state.lastImage) restart();
    };
    panel.querySelector(".solv-model").onchange = (e) => {
      settings.models = { ...settings.models, [settings.provider]: e.target.value }; saveSettings();
      if (state.lastQuestion || state.lastImage) restart();
    };
    panel.querySelectorAll(".solv-mode").forEach((b) => {
      b.onclick = () => {
        panel.querySelectorAll(".solv-mode").forEach((x) => x.classList.remove("is-on"));
        b.classList.add("is-on"); state.mode = b.dataset.mode;
        if (state.lastQuestion || state.lastImage) restart();
      };
    });
    panel.querySelector(".solv-followup").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    makeDraggable(panel, panel.querySelector(".solv-head"));
    chrome.storage.local.get("panelPos").then(({ panelPos }) => {
      if (panelPos) { panel.style.right = "auto"; panel.style.left = panelPos.left + "px"; panel.style.top = panelPos.top + "px"; }
    });
    refreshModelSelect();
    applyOverlayPrefs();
    return panel;
  }
  const flash = (btn, label) => { const old = btn.textContent; btn.textContent = label; setTimeout(() => (btn.textContent = old), 1200); };
  function makeDraggable(el, handle) {
    let sx, sy, ox, oy, drag = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest(".solv-icon")) return;
      drag = true; sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      el.style.right = "auto"; document.body.style.userSelect = "none";
    });
    window.addEventListener("mousemove", (e) => { if (!drag) return; el.style.left = `${ox + e.clientX - sx}px`; el.style.top = `${oy + e.clientY - sy}px`; });
    window.addEventListener("mouseup", () => {
      if (drag) { const r = el.getBoundingClientRect(); chrome.storage.local.set({ panelPos: { left: Math.round(r.left), top: Math.round(r.top) } }); }
      drag = false; document.body.style.userSelect = "";
    });
  }

  // ---------- state ----------
  const state = { messages: [], answer: "", image: null, busy: false, abort: null, mode: "short", lastQuestion: null, lastImage: null, runId: 0 };
  const abortCurrent = () => { try { state.abort?.(); } catch {} state.abort = null; };
  const restart = () => startSolve({ questionText: state.lastQuestion, image: state.lastImage });

  async function startSolve({ questionText, image }) {
    settings = await getSettings();
    if (!hasCredsFor(settings)) { openOptionsHint(); return; }
    makePanel(); panel.classList.remove("solv-collapsed");
    syncToolbar();
    state.lastQuestion = questionText || null; state.lastImage = image || null;
    const qEl = panel.querySelector(".solv-question");
    qEl.classList.toggle("has-image", !!image);
    if (image) qEl.innerHTML = `<div class="solv-question-image"><img src="${image}" alt="" /><span>${escapeHtml(questionText || "Image question")}</span></div>`;
    else qEl.textContent = questionText;
    qEl.title = questionText || "";
    state.image = image || null;
    state.messages = [
      { role: "system", content: SOLV.buildSystem(state.mode, settings.modePrompts) },
      { role: "user", content: image ? (questionText || "Solve the question shown in the image.") : questionText }
    ];
    await stream();
  }
  function syncToolbar() {
    const ps = panel.querySelector(".solv-provider"); if (ps.value !== settings.provider) ps.value = settings.provider;
    refreshModelSelect();
    panel.querySelectorAll(".solv-mode").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === state.mode));
  }

  async function stream() {
    if (state.busy) abortCurrent();
    const runId = ++state.runId;
    const controller = new AbortController();
    state.busy = true; state.answer = "";
    const ansEl = panel.querySelector(".solv-answer");
    const finalEl = panel.querySelector(".solv-final");
    const statusEl = panel.querySelector(".solv-status");
    const verifyEl = panel.querySelector(".solv-verify");
    finalEl.hidden = true; finalEl.innerHTML = ""; ansEl.innerHTML = ""; verifyEl.innerHTML = "";
    const act = panel.querySelector(".solv-actions"); if (act) act.hidden = true;
    const waitMsg = SOLV.WEB_PROVIDERS.has(settings.provider)
      ? (state.image ? "attaching image in your logged-in session…" : "asking your logged-in session…")
      : "thinking…";
    statusEl.innerHTML = `<span class="solv-dots"><i></i><i></i><i></i></span> ${waitMsg}`;
    let aborted = false; state.abort = () => { aborted = true; controller.abort(); };
    try {
      await runSolve({ messages: state.messages, image: state.image, signal: controller.signal, onToken: (t) => {
        if (aborted || runId !== state.runId) return; state.answer += t; ansEl.innerHTML = renderMd(stripConfidence(state.answer));
      } });
      if (aborted || runId !== state.runId) return;
      statusEl.textContent = "";
      state.messages.push({ role: "assistant", content: state.answer });
      renderStructured(finalEl, ansEl);
      maybeAutoVerify();
    } catch (e) {
      if (String(e.message || e) === "aborted") return;
      showError(String(e.message || e), SOLV.friendlyError(String(e.message || e), settings.provider));
    } finally { if (runId === state.runId) state.busy = false; }
  }

  function confBadge(conf) {
    if (conf == null) return "";
    return `<span class="solv-conf-badge" data-tone="${SOLV.render.confTone(conf)}" title="Model's self-rated confidence">${conf}%</span>`;
  }
  function renderStructured(finalEl, ansEl) {
    const o = settings.overlay || {};
    const r = SOLV.render.parseResult(state.answer);
    const hint = state.mode === "hint";
    const label = hint ? "Hint" : r.choice ? "Correct choice" : "Answer";
    const core = r.choice
      ? `<div class="solv-choice"><div class="solv-choice-badge">${r.choice}</div><div class="solv-choice-text">${r.choiceText ? renderMd(r.choiceText) : ""}</div></div>`
      : `<div class="solv-final-text">${renderMd(r.answer)}</div>`;
    const badge = o.showConf !== false ? confBadge(r.confidence) : "";
    const meta = o.showMeta === true
      ? `<div class="solv-meta">${escapeHtml(SOLV.PROVIDER_LABELS[settings.provider])} · ${escapeHtml(SOLV.WEB_PROVIDERS.has(settings.provider) ? "your model" : modelFor(settings.provider))}</div>` : "";
    finalEl.hidden = false;
    finalEl.innerHTML = `<div class="solv-final-head"><span class="solv-final-label">${escapeHtml(label)}</span>${badge}</div>${core}${meta}`;
    ansEl.innerHTML = (o.showReasoning !== false && r.rest)
      ? `<details class="solv-reason"${r.rest.length < 260 ? " open" : ""}><summary>Show reasoning</summary><div class="solv-reason-body">${renderMd(r.rest)}</div></details>`
      : "";
    const actions = panel.querySelector(".solv-actions");
    if (actions) actions.hidden = !(o.showActions !== false);
  }
  function maybeAutoVerify() {
    const conf = parseConfidence(state.answer);
    if (settings.autoVerify && conf != null && conf < (settings.confidenceThreshold ?? 70)) verify(false);
  }
  async function verify() {
    const vEl = panel.querySelector(".solv-verify");
    vEl.innerHTML = `<span class="solv-dots"><i></i><i></i><i></i></span> double-checking independently…`;
    const original = state.answer; let second = "";
    try {
      await runSolve({
        messages: [
          { role: "system", content: SOLV.buildSystem("steps", settings.modePrompts) },
          { role: "user", content: state.messages.find((m) => m.role === "user")?.content || "" },
          { role: "user", content: "Solve this independently from scratch. Do not assume any earlier answer was correct. Re-derive carefully and double-check the arithmetic." }
        ],
        image: state.image, signal: new AbortController().signal, onToken: (t) => { second += t; }
      });
      const agree = firstLine(original) && firstLine(original) === firstLine(second);
      const c2 = parseConfidence(second);
      vEl.innerHTML = agree
        ? `<span class="solv-badge good">✓ Double-checked — both attempts agree${c2 != null ? ` · ${c2}%` : ""}</span>`
        : `<span class="solv-badge bad">⚠ Attempts disagree — review</span><details class="solv-reason"><summary>See 2nd attempt</summary><div class="solv-reason-body">${renderMd(stripConfidence(second))}</div></details>`;
    } catch (e) { vEl.innerHTML = `<span class="solv-err">re-check failed.</span>`; }
  }
  async function followUp(q) {
    state.messages.push({ role: "user", content: q });
    panel.querySelector(".solv-question").textContent = q;
    state.lastQuestion = q; state.image = null; state.lastImage = null;
    await stream();
  }
  const solveText = (text) => startSolve({ questionText: text });

  // Hand the current question/answer/conversation over to the side panel chat.
  function delegateToSide() {
    const imageTooLarge = state.lastImage && state.lastImage.length > 4_000_000;
    const handoff = {
      ts: Date.now(),
      provider: settings.provider,
      model: SOLV.WEB_PROVIDERS.has(settings.provider) ? null : modelFor(settings.provider),
      mode: state.mode,
      question: state.lastQuestion,
      image: imageTooLarge ? null : (state.lastImage || null),
      imageOmitted: !!imageTooLarge,
      answer: state.answer || "",
      messages: state.messages.filter((m) => m.role !== "system")
    };
    // fire-and-forget storage write + open in the same user gesture (keeps the open() gesture valid)
    chrome.storage.local.set({ solvHandoff: handoff });
    chrome.runtime.sendMessage({ type: "openSidePanel" }, (resp) => {
      if (resp?.ok) panel?._close?.();
      else showError(resp?.error || "Side panel unavailable", {
        title: "Side panel could not open",
        steps: [
          "Open the Solv popup and choose Side panel.",
          "Make sure this Chrome profile supports side panels.",
          "You can keep using the floating overlay here."
        ]
      });
    });
  }

  // ---------- error UI ----------
  function showError(raw, help) {
    const statusEl = panel.querySelector(".solv-status");
    const finalEl = panel.querySelector(".solv-final");
    finalEl.hidden = true;
    const steps = (help.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    statusEl.innerHTML = `
      <div class="solv-error-card">
        <div class="solv-error-title">⚠ ${escapeHtml(help.title || "Error")}</div>
        <ol class="solv-error-steps">${steps}</ol>
        <div class="solv-error-actions">
          <button class="solv-btn solv-retry">Retry</button>
          ${help.action === "options" ? `<button class="solv-btn solv-open-opts">Open settings</button>` : ""}
          <span class="solv-error-raw" title="${escapeAttr(raw)}">details</span>
        </div>
      </div>`;
    statusEl.querySelector(".solv-retry").onclick = () => stream();
    statusEl.querySelector(".solv-open-opts")?.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openOptions" }));
  }

  // ---------- region screenshot ----------
  function startRegion() {
    const layer = document.createElement("div");
    layer.className = "solv-region";
    layer.innerHTML = `<div class="solv-region-hint">Drag around the question · Esc to cancel</div><div class="solv-rect" hidden></div>`;
    document.body.appendChild(layer);
    const rectEl = layer.querySelector(".solv-rect");
    let sx, sy, drawing = false;
    const cleanup = () => { layer.remove(); window.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") cleanup(); };
    window.addEventListener("keydown", onKey);
    layer.addEventListener("mousedown", (e) => { drawing = true; sx = e.clientX; sy = e.clientY; rectEl.hidden = false; Object.assign(rectEl.style, { left: sx + "px", top: sy + "px", width: "0px", height: "0px" }); });
    layer.addEventListener("mousemove", (e) => {
      if (!drawing) return;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      Object.assign(rectEl.style, { left: x + "px", top: y + "px", width: Math.abs(e.clientX - sx) + "px", height: Math.abs(e.clientY - sy) + "px" });
    });
    layer.addEventListener("mouseup", async (e) => {
      if (!drawing) return; drawing = false;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      cleanup();
      if (w < 8 || h < 8) return;
      const image = await captureRegion(x, y, w, h);
      if (image) startSolve({ image });
      else {
        settings = settings || await getSettings();
        makePanel();
        panel.classList.remove("solv-collapsed");
        panel.querySelector(".solv-question").textContent = "Screenshot capture";
        showError("capture failed", {
          title: "Couldn't capture this page",
          steps: [
            "Chrome blocks screenshots on some internal or protected pages.",
            "Try the same question on a normal web page, or paste/attach an image in the side panel.",
            "If the page just changed, reload it and try the region capture again."
          ]
        });
      }
    });
  }
  function captureRegion(x, y, w, h) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "capture" }, (resp) => {
        if (!resp?.ok) { resolve(null); return; }
        const img = new Image();
        img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          const canvas = document.createElement("canvas");
          const rawW = Math.round(w * dpr), rawH = Math.round(h * dpr);
          const maxSide = 1800;
          const scale = Math.min(1, maxSide / Math.max(rawW, rawH));
          canvas.width = Math.max(1, Math.round(rawW * scale));
          canvas.height = Math.max(1, Math.round(rawH * scale));
          canvas.getContext("2d").drawImage(img, x * dpr, y * dpr, rawW, rawH, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.9));
        };
        img.onerror = () => resolve(null);
        img.src = resp.dataUrl;
      });
    });
  }

  // ---------- creds / hints ----------
  const hasCredsFor = (s) =>
    s.provider === "openai" ? !!s.keys.openai :
    s.provider === "anthropic" ? !!s.keys.anthropic :
    s.provider === "gemini" ? !!s.keys.gemini : true;
  function openOptionsHint() {
    makePanel(); panel.classList.remove("solv-collapsed"); syncToolbar();
    panel.querySelector(".solv-question").textContent = "Setup needed";
    showError("missing key", {
      title: `Add a key for ${SOLV.PROVIDER_LABELS[settings.provider]}`,
      steps: ["Open Settings and paste the API key for this provider.", "Or switch (top-left) to a login / Ollama / Chrome AI provider — those need no key."],
      action: "options"
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "trigger-selection") { const t = window.getSelection()?.toString().trim(); t ? solveText(t) : startRegion(); }
    if (msg.type === "trigger-region") startRegion();
  });
  getSettings().then((s) => { settings = s; if (settings.defaultMode) state.mode = settings.defaultMode; });
})();

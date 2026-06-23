const DEFAULTS = {
  provider: "openai",
  keys: { openai: "", openrouter: "", anthropic: "", gemini: "", custom_openai: "" },
  models: {
    openai: "gpt-5.4-mini",
    openrouter: "openai/gpt-4o-mini",
    custom_openai: "gpt-4o-mini",
    anthropic: "claude-sonnet-4-6",
    gemini: "gemini-2.5-flash",
    ollama: "llama3.2",
    builtin: "gemini-nano"
  },
  customOpenAI: {
    name: "Custom provider",
    baseUrl: "https://api.openai.com/v1",
    key: "",
    model: "gpt-4o-mini",
    authHeader: "Authorization",
    authPrefix: "Bearer"
  },
  ollamaUrl: "http://localhost:11434",
  confidenceThreshold: 70,
  autoVerify: true,
  webFocusTab: false,
  defaultMode: "short",
  modePrompts: {},
  visibleProviders: [],
  visibleModes: [],
  overlay: { compact: true, showModel: true, showModes: true, showConf: true, showReasoning: true, showMeta: false, showActions: true, showFollowup: true },
  theme: "auto"
};
const OV_KEYS = ["compact", "showModel", "showModes", "showConf", "showReasoning", "showMeta", "showActions", "showFollowup"];

const SOLV = globalThis.SOLV;
const $ = (id) => document.getElementById(id);
const esc = (s = "") => SOLV.render.escapeHtml(String(s)).replace(/"/g, "&quot;");
let browserCaps = SOLV.browserInfo();

function supportFor(provider) {
  return SOLV.providerSupport(provider, browserCaps);
}

function renderBrowserSupport() {
  browserCaps = SOLV.browserInfo();
  const rows = [
    ["Browser", browserCaps.name],
    ["Side panel", browserCaps.sidePanel ? "Native side panel" : "Extension tab fallback"],
    ["Built-in AI", browserCaps.promptApi ? "Available" : "Not available here"],
    ["Custom endpoints", browserCaps.permissionsRequest ? "Runtime permission prompts supported" : "May need pre-granted host access"]
  ];
  $("browserSupport").innerHTML = `<h3>Browser support</h3><ol>${rows.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join("")}</ol>`;
}

function applyProviderOptionSupport() {
  document.querySelectorAll("#provider option").forEach((opt) => {
    const support = supportFor(opt.value);
    opt.disabled = !support.ok;
    if (!support.ok || support.warn) opt.textContent = `${SOLV.PROVIDER_LABELS[opt.value] || opt.textContent} — ${support.ok ? "limited" : "unsupported"}`;
    opt.title = support.reason || support.warn || "";
  });
  if ($("provider").selectedOptions[0]?.disabled) {
    const first = [...$("provider").options].find((o) => !o.disabled);
    if (first) $("provider").value = first.value;
  }
}

function buildModeUI(selectedMode, modePrompts) {
  $("defaultMode").innerHTML = SOLV.MODES.map((m) =>
    `<option value="${esc(m.id)}"${m.id === selectedMode ? " selected" : ""}>${esc(m.label)} — ${esc(m.desc)}</option>`).join("");
  $("modePrompts").innerHTML = SOLV.MODES.map((m) =>
    `<label>${esc(m.label)} <span style="color:var(--mut);text-transform:none;letter-spacing:0">(${esc(m.desc)})</span></label>
     <textarea data-mode="${esc(m.id)}" placeholder="${esc(m.prompt)}">${SOLV.render.escapeHtml((modePrompts && modePrompts[m.id]) || "")}</textarea>`).join("");
}
function readModePrompts() {
  const out = {};
  document.querySelectorAll("#modePrompts textarea").forEach((t) => { const v = t.value.trim(); if (v) out[t.dataset.mode] = v; });
  return out;
}
function buildVisChecks(containerId, pairs, selected) {
  // selected === [] means "all"; we store the explicit list only when a subset is chosen
  const all = pairs.map((p) => p[0]);
  const isAll = !selected || selected.length === 0;
  $(containerId).innerHTML = pairs.map(([id, label]) =>
    `<label><input type="checkbox" data-id="${esc(id)}" ${isAll || selected.includes(id) ? "checked" : ""}/> ${esc(label)}</label>`).join("");
}
function readVisChecks(containerId, total) {
  const chosen = [...document.querySelectorAll(`#${containerId} input`)].filter((c) => c.checked).map((c) => c.dataset.id);
  return chosen.length === total ? [] : chosen; // [] = all
}

function readSettingsFromForm() {
  return {
    provider: $("provider").value,
    keys: {
      openai: $("key_openai").value.trim(),
      openrouter: $("key_openrouter").value.trim(),
      anthropic: $("key_anthropic").value.trim(),
      gemini: $("key_gemini").value.trim(),
      custom_openai: $("key_custom_openai").value.trim()
    },
    models: {
      openai: $("model_openai").value.trim() || DEFAULTS.models.openai,
      openrouter: $("model_openrouter").value.trim() || DEFAULTS.models.openrouter,
      custom_openai: $("model_custom_openai").value.trim() || DEFAULTS.models.custom_openai,
      anthropic: $("model_anthropic").value.trim() || DEFAULTS.models.anthropic,
      gemini: $("model_gemini").value.trim() || DEFAULTS.models.gemini,
      ollama: $("model_ollama").value.trim() || DEFAULTS.models.ollama,
      builtin: DEFAULTS.models.builtin
    },
    customOpenAI: {
      name: $("customName").value.trim() || DEFAULTS.customOpenAI.name,
      baseUrl: $("customBaseUrl").value.trim() || DEFAULTS.customOpenAI.baseUrl,
      key: $("key_custom_openai").value.trim(),
      model: $("model_custom_openai").value.trim() || DEFAULTS.models.custom_openai,
      authHeader: $("customAuthHeader").value.trim() || DEFAULTS.customOpenAI.authHeader,
      authPrefix: $("customAuthPrefix").value.trim()
    },
    ollamaUrl: $("ollamaUrl").value.trim() || DEFAULTS.ollamaUrl,
    confidenceThreshold: parseInt($("confidenceThreshold").value, 10),
    autoVerify: $("autoVerify").checked,
    webFocusTab: $("webFocusTab").checked,
    defaultMode: $("defaultMode").value,
    modePrompts: readModePrompts(),
    overlay: OV_KEYS.reduce((o, k) => (o[k] = $("ov_" + k).checked, o), {}),
    visibleProviders: readVisChecks("visProviders", SOLV.PROVIDER_GROUPS.flatMap((g) => g.items).length),
    visibleModes: readVisChecks("visModes", SOLV.MODES.length),
    theme: "auto"
  };
}

async function load() {
  const stored = await chrome.storage.local.get("settings");
  const s = {
    ...DEFAULTS, ...(stored.settings || {}),
    keys: { ...DEFAULTS.keys, ...(stored.settings?.keys || {}) },
    models: { ...DEFAULTS.models, ...(stored.settings?.models || {}) },
    customOpenAI: { ...DEFAULTS.customOpenAI, ...(stored.settings?.customOpenAI || {}) },
    overlay: { ...DEFAULTS.overlay, ...(stored.settings?.overlay || {}) }
  };
  renderBrowserSupport();
  $("provider").value = s.provider;
  applyProviderOptionSupport();
  $("key_openai").value = s.keys.openai;
  $("key_openrouter").value = s.keys.openrouter;
  $("key_anthropic").value = s.keys.anthropic;
  $("key_gemini").value = s.keys.gemini;
  $("key_custom_openai").value = s.customOpenAI.key || s.keys.custom_openai || "";
  $("model_openai").value = s.models.openai;
  $("model_openrouter").value = s.models.openrouter;
  $("model_custom_openai").value = s.models.custom_openai || s.customOpenAI.model;
  $("model_anthropic").value = s.models.anthropic;
  $("model_gemini").value = s.models.gemini;
  $("model_ollama").value = s.models.ollama;
  $("ollamaUrl").value = s.ollamaUrl;
  $("customName").value = s.customOpenAI.name;
  $("customBaseUrl").value = s.customOpenAI.baseUrl;
  $("customAuthHeader").value = s.customOpenAI.authHeader;
  $("customAuthPrefix").value = s.customOpenAI.authPrefix;
  $("confidenceThreshold").value = s.confidenceThreshold;
  $("thVal").textContent = s.confidenceThreshold;
  $("autoVerify").checked = s.autoVerify;
  $("webFocusTab").checked = s.webFocusTab;
  OV_KEYS.forEach((k) => { $("ov_" + k).checked = s.overlay[k] !== false; });
  buildVisChecks("visProviders", SOLV.PROVIDER_GROUPS.flatMap((g) => g.items).map((p) => {
    const support = supportFor(p);
    const suffix = !support.ok ? " (unsupported here)" : support.warn ? " (limited)" : "";
    return [p, `${SOLV.PROVIDER_LABELS[p]}${suffix}`];
  }), s.visibleProviders);
  buildVisChecks("visModes", SOLV.MODES.map((m) => [m.id, m.label]), s.visibleModes);
  buildModeUI(s.defaultMode || "short", s.modePrompts || {});
}

$("resetPrompts").addEventListener("click", () => { document.querySelectorAll("#modePrompts textarea").forEach((t) => (t.value = "")); });

$("resetOverlayPosition").addEventListener("click", async () => {
  await chrome.storage.local.remove("panelPos");
  const status = $("resetOverlayStatus");
  status.className = "test-status good";
  status.textContent = "Overlay position reset. The next overlay opens beside your selection or capture.";
});

$("confidenceThreshold").addEventListener("input", (e) => ($("thVal").textContent = e.target.value));

function endpointOriginPattern(raw) {
  const url = new URL(String(raw || "").trim());
  return `${url.origin}/*`;
}
async function requestCustomEndpointAccess() {
  const status = $("test_custom_openai");
  try {
    const origin = endpointOriginPattern($("customBaseUrl").value || DEFAULTS.customOpenAI.baseUrl);
    if (!chrome.permissions?.request) {
      status.className = "test-status bad";
      status.textContent = "This browser does not expose chrome.permissions.request. Add the endpoint to host permissions or use a built-in provider.";
      return false;
    }
    const granted = await chrome.permissions.request({ origins: [origin] });
    status.className = "test-status " + (granted ? "good" : "bad");
    status.textContent = granted ? `Endpoint access granted for ${origin}` : `Endpoint access was not granted for ${origin}`;
    return granted;
  } catch (e) {
    status.className = "test-status bad";
    status.textContent = String(e?.message || e);
    return false;
  }
}
$("grantCustomEndpoint").addEventListener("click", requestCustomEndpointAccess);

document.querySelectorAll("[data-test]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const provider = btn.dataset.test;
    const status = $("test_" + provider);
    btn.disabled = true;
    status.className = "test-status";
    status.textContent = "Testing connection...";
    if (provider === "builtin") {
      try {
        const message = await testBuiltinAI();
        status.className = "test-status good";
        status.textContent = message;
      } catch (e) {
        status.className = "test-status bad";
        status.textContent = String(e?.message || e);
      } finally {
        btn.disabled = false;
      }
      return;
    }
    if (provider === "custom_openai") await requestCustomEndpointAccess();
    chrome.runtime.sendMessage({ type: "testProvider", provider, settings: readSettingsFromForm() }, (resp) => {
      btn.disabled = false;
      const ok = !!resp?.ok;
      status.className = "test-status " + (ok ? "good" : "bad");
      status.textContent = ok ? resp.message : (resp?.error || "Connection test failed.");
    });
  });
});

async function testBuiltinAI() {
  const API = (typeof LanguageModel !== "undefined") ? LanguageModel : globalThis.ai?.languageModel;
  if (!API) throw new Error("Prompt API not found. Enable Gemini Nano / Prompt API in chrome://flags, then reload this page.");
  const opts = {
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }]
  };
  let availability = "available";
  if (typeof API.availability === "function") availability = await API.availability(opts);
  if (availability === "unavailable" || availability === "no") throw new Error("Gemini Nano is unavailable on this device or Chrome profile.");
  if (availability === "downloadable" || availability === "downloading" || availability === "after-download") {
    const session = await API.create({
      ...opts,
      monitor(monitor) {
        monitor.addEventListener?.("downloadprogress", (e) => {
          if (Number.isFinite(e.loaded)) $("test_builtin").textContent = `Downloading model ${Math.round(e.loaded * 100)}%...`;
        });
      }
    });
    session.destroy?.();
    return "Chrome AI is enabled; model download has started.";
  }
  const params = typeof API.params === "function" ? await API.params().catch(() => null) : null;
  return params ? `Chrome AI ready. Default temperature ${params.defaultTemperature}, top-K ${params.defaultTopK}.` : "Chrome AI ready.";
}

document.querySelectorAll("[data-reset-model]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const provider = btn.dataset.resetModel;
    const field = $("model_" + provider);
    if (field && DEFAULTS.models[provider]) field.value = DEFAULTS.models[provider];
    const status = $("test_" + provider);
    if (status) {
      status.className = "test-status";
      status.textContent = `Reset to ${DEFAULTS.models[provider]}.`;
    }
  });
});

$("save").addEventListener("click", async () => {
  const settings = readSettingsFromForm();
  await chrome.storage.local.set({ settings });
  const el = $("saved"); el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1400);
});

load();

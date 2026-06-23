// background.js — service worker (module). Routes provider calls, streams tokens
// back over a Port, captures screenshots, wires context menu + commands.
import { streamChat, DEFAULT_MODELS } from "./providers.js";

// ---- web-session providers (drive your logged-in tab, no API key) ----
const WEB_SITES = {
  web_chatgpt: { url: "https://chatgpt.com/", match: ["https://chatgpt.com/*", "https://chat.openai.com/*"], label: "ChatGPT" },
  web_claude: { url: "https://claude.ai/new", match: ["https://claude.ai/*"], label: "Claude" },
  web_gemini: { url: "https://gemini.google.com/app", match: ["https://gemini.google.com/*"], label: "Gemini" }
};
const isWebProvider = (p) => p in WEB_SITES;
const sendTabMessage = (tabId, payload) => chrome.tabs.sendMessage(tabId, payload).catch(() => {});

async function ensureSiteTab(site) {
  const tabs = await chrome.tabs.query({ url: site.match });
  let tab = tabs.find((t) => t.status === "complete") || tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: site.url, active: false });
  }
  // wait until loaded
  for (let i = 0; i < 60 && tab.status !== "complete"; i++) {
    await new Promise((r) => setTimeout(r, 300));
    tab = await chrome.tabs.get(tab.id);
  }
  return tab;
}

async function webSolve({ provider, messages, image, onToken, signal, focusTab }) {
  const site = WEB_SITES[provider];
  // Remember where the user was, so we can restore focus afterwards.
  let prevTabId = null, prevWindowId = null;
  if (focusTab) {
    const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (cur) { prevTabId = cur.id; prevWindowId = cur.windowId; }
  }
  const tab = await ensureSiteTab(site);
  if (focusTab) {
    try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["web-driver.js"] });
  const prompt = buildWebPrompt(messages);
  const requestId = "w" + Math.random().toString(36).slice(2);
  const restoreFocus = () => {
    if (focusTab && prevTabId != null) {
      chrome.tabs.update(prevTabId, { active: true }).catch(() => {});
      if (prevWindowId != null) chrome.windows.update(prevWindowId, { focused: true }).catch(() => {});
    }
  };

  return new Promise((resolve, reject) => {
    let done = false;
    const onAbort = () => finish(reject, new Error("aborted"));
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      chrome.runtime.onMessage.removeListener(relay);
      signal?.removeEventListener?.("abort", onAbort);
      restoreFocus();
      fn(arg);
    };
    const relay = (m) => {
      if (m.requestId !== requestId) return;
      if (m.type === "solv-web-token") onToken(m.delta);
      else if (m.type === "solv-web-done") finish(resolve);
      else if (m.type === "solv-web-error") finish(reject, new Error(m.error));
    };
    chrome.runtime.onMessage.addListener(relay);
    signal?.addEventListener("abort", onAbort, { once: true });
    chrome.tabs.sendMessage(tab.id, { type: "solv-web-run", requestId, provider, prompt, image })
      .catch((e) => finish(reject, new Error("Couldn't reach the tab: " + e.message)));
  });
}

// Collapse our role-based messages into one prompt for chat web UIs (no system role).
function buildWebPrompt(messages) {
  const system = messages.find((m) => m.role === "system")?.content || "";
  const userTurns = messages.filter((m) => m.role === "user").map((m) => m.content);
  const lastUser = userTurns[userTurns.length - 1] || "";
  return (system ? system + "\n\n---\n\n" : "") + lastUser;
}

export const DEFAULTS = {
  provider: "openai",
  keys: { openai: "", openrouter: "", anthropic: "", gemini: "", custom_openai: "" },
  models: { ...DEFAULT_MODELS },
  customOpenAI: {
    name: "Custom provider",
    baseUrl: "https://api.openai.com/v1",
    key: "",
    model: DEFAULT_MODELS.custom_openai,
    authHeader: "Authorization",
    authPrefix: "Bearer"
  },
  ollamaUrl: "http://localhost:11434",
  confidenceThreshold: 70,
  autoVerify: true,
  defaultMode: "short",
  modePrompts: {},
  webFocusTab: false,   // briefly focus the AI tab while solving (guaranteed capture, but steals focus)
  visibleProviders: [],   // [] = show all
  visibleModes: [],       // [] = show all
  providerMemory: {},
  overlay: {
    compact: true,        // hide provider/model/mode controls behind the ⚙ by default
    showModel: true, showModes: true, showConf: true,
    showReasoning: true, showMeta: false, showActions: true, showFollowup: true
  },
  theme: "auto"
};

async function getSettings() {
  const stored = await chrome.storage.local.get(["settings", "providerMemory"]);
  return { ...DEFAULTS, ...(stored.settings || {}),
    keys: { ...DEFAULTS.keys, ...(stored.settings?.keys || {}) },
    models: { ...DEFAULTS.models, ...(stored.settings?.models || {}) },
    customOpenAI: { ...DEFAULTS.customOpenAI, ...(stored.settings?.customOpenAI || {}) },
    providerMemory: { ...(stored.providerMemory || stored.settings?.providerMemory || {}) },
    overlay: { ...DEFAULTS.overlay, ...(stored.settings?.overlay || {}) } };
}

async function rememberProviderFailure(provider, error) {
  if (!isWebProvider(provider)) return;
  const { providerMemory = {} } = await chrome.storage.local.get("providerMemory");
  const msg = String(error || "");
  providerMemory[provider] = {
    lastError: msg.slice(0, 240),
    lastFailedAt: Date.now(),
    imageUploadFailed: /attach|image|file input|drop|paste/i.test(msg),
    sendFailed: /send|trigger|composer|chat box|response detected/i.test(msg)
  };
  await chrome.storage.local.set({ providerMemory });
}

async function rememberProviderSuccess(provider) {
  if (!isWebProvider(provider)) return;
  const { providerMemory = {} } = await chrome.storage.local.get("providerMemory");
  if (!providerMemory[provider]) return;
  providerMemory[provider] = { ...providerMemory[provider], lastSuccessAt: Date.now(), imageUploadFailed: false, sendFailed: false };
  await chrome.storage.local.set({ providerMemory });
}

async function testProviderConnection(provider, overrides = {}) {
  const current = await getSettings();
  const settings = { ...current, ...overrides };
  settings.keys = { ...current.keys, ...(overrides.keys || {}) };
  settings.models = { ...current.models, ...(overrides.models || {}) };
  settings.customOpenAI = { ...current.customOpenAI, ...(overrides.customOpenAI || {}) };
  const key = settings.keys?.[provider];
  if (["openai", "openrouter", "anthropic", "gemini"].includes(provider) && !key) {
    throw new Error(`Add a ${provider} API key first.`);
  }
  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 180) || res.statusText}`);
    return "OpenAI key accepted.";
  }
  if (provider === "openrouter") {
    const res = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 180) || res.statusText}`);
    return "OpenRouter key accepted.";
  }
  if (provider === "custom_openai") {
    const cfg = settings.customOpenAI || {};
    const base = String(cfg.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
    if (!/^https?:\/\//i.test(base)) throw new Error("Enter a custom endpoint starting with http:// or https://.");
    const model = settings.models?.custom_openai || cfg.model || DEFAULT_MODELS.custom_openai;
    const header = String(cfg.authHeader || "Authorization").trim() || "Authorization";
    const prefix = String(cfg.authPrefix ?? "Bearer").trim();
    const customKey = String(cfg.key || settings.keys?.custom_openai || "").trim();
    const headers = { "Content-Type": "application/json" };
    if (customKey) headers[header] = prefix ? `${prefix} ${customKey}` : customKey;
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 4,
        messages: [{ role: "user", content: "ping" }]
      })
    });
    if (!res.ok) throw new Error(`Custom provider ${res.status}: ${(await res.text()).slice(0, 180) || res.statusText}`);
    return "Custom OpenAI-compatible endpoint accepted.";
  }
  if (provider === "anthropic") {
    const model = settings.models?.anthropic || DEFAULT_MODELS.anthropic;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] })
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 180) || res.statusText}`);
    return "Anthropic key and model accepted.";
  }
  if (provider === "gemini") {
    const model = settings.models?.gemini || DEFAULT_MODELS.gemini;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${key}`);
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 180) || res.statusText}`);
    return "Gemini key and model accepted.";
  }
  if (provider === "ollama") {
    const base = (settings.ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 180) || res.statusText}`);
    return "Ollama is reachable.";
  }
  throw new Error("This provider does not need a connection test.");
}

// ---- keepalive: stop MV3 from killing the worker mid-request ----
let activeJobs = 0;
let keepaliveTimer = null;
function keepaliveStart() {
  activeJobs++;
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20000);
}
function keepaliveStop() {
  activeJobs = Math.max(0, activeJobs - 1);
  if (activeJobs === 0 && keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

// ---- streaming port ----
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "solv-stream") return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "solve") return;
    keepaliveStart();
    let alive = true;
    const beat = setInterval(() => { try { port.postMessage({ type: "ping" }); } catch { alive = false; } }, 15000);
    try {
      const settings = await getSettings();
      const { provider, model, messages, image } = msg.payload;
      const onToken = (t) => { try { port.postMessage({ type: "token", text: t }); } catch {} };
      if (isWebProvider(provider)) {
        await webSolve({ provider, messages, image, onToken, signal: controller.signal, focusTab: settings.webFocusTab });
      } else {
        await streamChat({ provider, settings, model, messages, image, signal: controller.signal, onToken });
      }
      await rememberProviderSuccess(provider);
      try { port.postMessage({ type: "done" }); } catch {}
    } catch (e) {
      try { await rememberProviderFailure(msg.payload?.provider, e?.message || e); } catch {}
      try { port.postMessage({ type: "error", error: String(e.message || e) }); } catch {}
    } finally {
      clearInterval(beat); keepaliveStop();
    }
  });
});

// ---- one-shot messages (screenshot capture, settings fetch) ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "capture") {
    if (!sender.tab?.windowId) {
      sendResponse({ ok: false, error: "No active tab available for capture." });
      return true;
    }
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg.type === "getSettings") {
    getSettings().then((s) => sendResponse(s));
    return true;
  }
  if (msg.type === "testProvider") {
    testProviderConnection(msg.provider, msg.settings || {})
      .then((message) => sendResponse({ ok: true, message }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
  if (msg.type === "openSidePanel") {
    const tabId = sender.tab?.id;
    (async () => {
      try {
        if (!chrome.sidePanel?.open) {
          await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html"), active: true });
          sendResponse({ ok: true, fallback: "tab" });
          return;
        }
        if (tabId != null) await chrome.sidePanel.open({ tabId });
        else {
          const w = await chrome.windows.getCurrent();
          await chrome.sidePanel.open({ windowId: w.id });
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true;
  }
});

// allow the side panel to open from the toolbar icon too (optional convenience)
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false })?.catch(() => {});

// ---- commands (keyboard shortcuts) ----
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === "solve-selection") sendTabMessage(tab.id, { type: "trigger-selection" });
  if (command === "solve-region") sendTabMessage(tab.id, { type: "trigger-region" });
});

// ---- context menu ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "solv-selection",
      title: "Solve \"%s\" with Solv",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "solv-region",
      title: "Solv: screenshot a region",
      contexts: ["page", "image"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "solv-selection") sendTabMessage(tab.id, { type: "trigger-selection" });
  if (info.menuItemId === "solv-region") sendTabMessage(tab.id, { type: "trigger-region" });
});

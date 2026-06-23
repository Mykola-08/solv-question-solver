const SOLV = globalThis.SOLV;
const $ = (id) => document.getElementById(id);
const HINTS = {
  web_chatgpt: "Uses your logged-in ChatGPT tab — your subscription, no key. Images are attached best-effort through ChatGPT.",
  web_claude: "Uses your logged-in Claude tab — your subscription, no key. Images are attached best-effort through Claude.",
  web_gemini: "Uses your logged-in Gemini tab — your subscription, no key. Images are attached best-effort through Gemini.",
  openai: "Needs an OpenAI API key (Settings). Recent OpenAI multimodal models can read images.",
  openrouter: "Needs an OpenRouter key. Routes many OpenAI-compatible models through one endpoint.",
  custom_openai: "Uses your custom OpenAI-compatible endpoint, model, key, and auth header from Settings.",
  anthropic: "Needs an Anthropic API key. Sonnet is the safest default; Opus may require account access.",
  gemini: "Needs a Google AI Studio key. Gemini reads images.",
  ollama: "Local — no key. Run `ollama serve`. Use a vision model (llava) for images.",
  builtin: "On-device Gemini Nano. No key. Needs a recent Chrome with the Prompt API."
};
let settings = {};
const supportFor = (provider) => SOLV.providerSupport(provider, SOLV.browserInfo());
const hasCreds = (p) => p === "openai" ? !!settings.keys?.openai :
  p === "openrouter" ? !!settings.keys?.openrouter :
  p === "custom_openai" ? !!settings.customOpenAI?.baseUrl :
  p === "anthropic" ? !!settings.keys?.anthropic :
  p === "gemini" ? !!settings.keys?.gemini : true;
function showStatus(text = "Saved", tone = "good") {
  const s = $("status");
  s.textContent = text;
  s.classList.toggle("bad", tone === "bad");
  s.classList.add("show");
  setTimeout(() => s.classList.remove("show"), 1800);
}

async function load() {
  settings = await new Promise((res) => chrome.runtime.sendMessage({ type: "getSettings" }, res));
  const allow = settings.visibleProviders || [];
  $("provider").innerHTML = SOLV.PROVIDER_GROUPS.map((g) => {
    const items = g.items.filter((p) => !allow.length || allow.includes(p) || p === settings.provider);
    return items.length ? `<optgroup label="${g.label}">` +
      items.map((p) => {
        const support = supportFor(p);
        const label = `${SOLV.PROVIDER_LABELS[p]}${support.ok ? "" : " — unsupported"}`;
        return `<option value="${p}"${p === settings.provider ? " selected" : ""}${support.ok ? "" : " disabled"} title="${support.reason || support.warn || ""}">${label}</option>`;
      }).join("") +
      `</optgroup>` : "";
  }).join("");
  if ($("provider").selectedOptions[0]?.disabled) {
    const first = [...$("provider").options].find((o) => !o.disabled);
    if (first) $("provider").value = first.value;
  }
  syncModel();
}
function syncModel() {
  const p = $("provider").value;
  const sel = $("model"), custom = $("modelCustom"), list = SOLV.MODELS[p] || [];
  const ready = hasCreds(p);
  const support = supportFor(p);
  $("keyHint").textContent = !support.ok ? support.reason : ready ? HINTS[p] : `${HINTS[p]} Open Settings to add and test the key.`;
  if (SOLV.WEB_PROVIDERS.has(p)) { sel.innerHTML = `<option>set in the site</option>`; sel.disabled = true; custom.hidden = true; return; }
  sel.disabled = false;
  const cur = settings.models?.[p] || SOLV.DEFAULT_MODELS[p];
  const ids = list.map((m) => m.id);
  let html = list.map((m) => `<option value="${m.id}"${m.id === cur && ids.includes(cur) ? " selected" : ""}>${m.label}</option>`).join("");
  html += `<option value="__custom__"${!ids.includes(cur) ? " selected" : ""}>Custom…</option>`;
  sel.innerHTML = html;
  custom.hidden = ids.includes(cur);
  custom.value = ids.includes(cur) ? "" : cur;
}
$("provider").addEventListener("change", syncModel);
$("model").addEventListener("change", () => { $("modelCustom").hidden = $("model").value !== "__custom__"; if (!$("modelCustom").hidden) $("modelCustom").focus(); });

$("save").addEventListener("click", async () => {
  const p = $("provider").value;
  settings.provider = p;
  if (!SOLV.WEB_PROVIDERS.has(p)) {
    const chosen = $("model").value === "__custom__" ? ($("modelCustom").value.trim() || SOLV.DEFAULT_MODELS[p]) : $("model").value;
    settings.models = { ...settings.models, [p]: chosen };
  }
  await chrome.storage.local.set({ settings });
  showStatus(hasCreds(p) ? "Saved" : "Saved · setup needed", hasCreds(p) ? "good" : "bad");
});
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("side").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    if (!chrome.sidePanel?.open) {
      await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html"), active: true });
      window.close();
      return;
    }
    if (tab?.id != null) await chrome.sidePanel.open({ tabId: tab.id });
    else {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
    }
    window.close();
  } catch (e) {
    showStatus("Side panel unavailable", "bad");
  }
});

load();

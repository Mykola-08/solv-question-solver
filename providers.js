// providers.js — unified streaming chat across providers.
// Each call yields incremental text via onToken(deltaString).
// messages: [{ role:'system'|'user'|'assistant', content:string }]
// image: optional data URL (e.g. "data:image/png;base64,....") for the last user turn.

export const DEFAULT_MODELS = {
  openai: "gpt-5.4-mini",
  openrouter: "openai/gpt-4o-mini",
  custom_openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  ollama: "llama3.2",
  builtin: "gemini-nano"
};

const dataUrlParts = (dataUrl) => {
  // returns { mime, base64 }
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) throw new Error("Invalid image data. Capture or attach the image again.");
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(m[1])) throw new Error(`Unsupported image type: ${m[1]}`);
  if (!m[2] || m[2].length > 12_000_000) throw new Error("Image is too large. Capture a smaller region or use a smaller file.");
  return { mime: m[1], base64: m[2] };
};

async function* sseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

async function ensureOk(response, provider) {
  if (response.ok) return;
  let detail = "";
  try { detail = await response.text(); } catch {}
  throw new Error(`${provider} ${response.status}: ${detail.slice(0, 300) || response.statusText}`);
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
});
const retryableStatus = (status) => status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
async function providerFetch(provider, url, options) {
  const signal = options?.signal;
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!retryableStatus(res.status) || attempt === 2) return res;
      last = res;
    } catch (e) {
      if (signal?.aborted || attempt === 2) throw e;
      last = e;
    }
    await sleep(350 * (attempt + 1), signal);
  }
  if (last instanceof Response) return last;
  throw last;
}

// ---------- OpenAI ----------
async function openaiResponses({ settings, model, messages, image, onToken, signal }) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const input = messages.filter((m) => m.role !== "system").map((m, idx, arr) => {
    const content = [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }];
    if (image && idx === arr.length - 1 && m.role !== "assistant") {
      dataUrlParts(image);
      content.push({ type: "input_image", image_url: image });
    }
    return { role: m.role, content };
  });
  const res = await providerFetch("OpenAI", "https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.keys.openai}` },
    body: JSON.stringify({ model, instructions: system || undefined, input, stream: true })
  });
  await ensureOk(res, "OpenAI");
  let emitted = false;
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    let json;
    try {
      json = JSON.parse(data);
    } catch { continue; }
    if (json.type === "response.output_text.delta" && json.delta) { emitted = true; onToken(json.delta); }
    if (json.type === "response.error" && json.error?.message) throw new Error(json.error.message);
  }
  if (!emitted) throw new Error("OpenAI returned an empty response. Retry or choose another model.");
}

async function openaiChatCompletions({ settings, model, messages, image, onToken, signal }) {
  return openaiCompatible({
    providerName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    key: settings.keys.openai,
    model,
    messages,
    image,
    onToken,
    signal
  });
}

function normalizeOpenAIBaseUrl(raw) {
  const fallback = "https://api.openai.com/v1";
  const value = String(raw || fallback).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) throw new Error("Custom endpoint must start with http:// or https://.");
  return value.replace(/\/chat\/completions$/i, "");
}

function customAuthHeaders({ key, header = "Authorization", prefix = "Bearer" }) {
  const headers = { "Content-Type": "application/json" };
  const cleanKey = String(key || "").trim();
  const cleanHeader = String(header || "Authorization").trim() || "Authorization";
  const cleanPrefix = String(prefix || "").trim();
  if (cleanKey) headers[cleanHeader] = cleanPrefix ? `${cleanPrefix} ${cleanKey}` : cleanKey;
  return headers;
}

async function openaiCompatible({ providerName, baseUrl, key, authHeader, authPrefix, extraHeaders, model, messages, image, onToken, signal }) {
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  if (image) {
    dataUrlParts(image);
    const last = msgs[msgs.length - 1];
    last.content = [
      { type: "text", text: last.content || "Solve the question in this image." },
      { type: "image_url", image_url: { url: image } }
    ];
  }
  const url = `${normalizeOpenAIBaseUrl(baseUrl)}/chat/completions`;
  const res = await providerFetch(providerName, url, {
    method: "POST",
    signal,
    headers: { ...customAuthHeaders({ key, header: authHeader, prefix: authPrefix }), ...(extraHeaders || {}) },
    body: JSON.stringify({ model, messages: msgs, stream: true, temperature: 0.2 })
  });
  await ensureOk(res, providerName);
  let emitted = false;
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) { emitted = true; onToken(delta); }
    } catch {}
  }
  if (!emitted) throw new Error(`${providerName} returned an empty response. Retry or choose another model.`);
}

async function openai(args) {
  if (/^(gpt-5|o[0-9])/.test(args.model)) return openaiResponses(args);
  return openaiChatCompletions(args);
}

async function openrouter({ settings, model, messages, image, onToken, signal }) {
  await openaiCompatible({
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    key: settings.keys.openrouter,
    model,
    messages,
    image,
    onToken,
    signal,
    extraHeaders: {
      "HTTP-Referer": "https://solv.local",
      "X-Title": "Solv"
    }
  });
}

async function customOpenAI({ settings, model, messages, image, onToken, signal }) {
  const custom = settings.customOpenAI || {};
  await openaiCompatible({
    providerName: custom.name || "Custom provider",
    baseUrl: custom.baseUrl,
    key: custom.key ?? settings.keys.custom_openai,
    authHeader: custom.authHeader || "Authorization",
    authPrefix: custom.authPrefix ?? "Bearer",
    model: model || custom.model,
    messages,
    image,
    onToken,
    signal
  });
}

// ---------- Anthropic ----------
async function anthropic({ settings, model, messages, image, onToken, signal }) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conv = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role,
    content: m.content
  }));
  if (image) {
    const p = dataUrlParts(image);
    const last = conv[conv.length - 1];
    last.content = [
      { type: "image", source: { type: "base64", media_type: p.mime, data: p.base64 } },
      { type: "text", text: (typeof last.content === "string" ? last.content : "") || "Solve the question in this image." }
    ];
  }
  const res = await providerFetch("Anthropic", "https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.keys.anthropic,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({ model, system, messages: conv, max_tokens: 1500, stream: true })
  });
  await ensureOk(res, "Anthropic");
  let emitted = false;
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    try {
      const json = JSON.parse(line.slice(5).trim());
      if (json.type === "content_block_delta" && json.delta?.text) { emitted = true; onToken(json.delta.text); }
    } catch {}
  }
  if (!emitted) throw new Error("Anthropic returned an empty response. Retry or choose another model.");
}

// ---------- Gemini ----------
async function gemini({ settings, model, messages, image, onToken, signal }) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  if (image) {
    const p = dataUrlParts(image);
    contents[contents.length - 1].parts.push({ inline_data: { mime_type: p.mime, data: p.base64 } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${settings.keys.gemini}`;
  const res = await providerFetch("Gemini", url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { temperature: 0.2 }
    })
  });
  await ensureOk(res, "Gemini");
  let emitted = false;
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    try {
      const json = JSON.parse(line.slice(5).trim());
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      if (text) { emitted = true; onToken(text); }
    } catch {}
  }
  if (!emitted) throw new Error("Gemini returned an empty response. Retry or choose another model.");
}

// ---------- Ollama (local) ----------
async function ollama({ settings, model, messages, image, onToken, signal }) {
  const base = (settings.ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  if (image) {
    const p = dataUrlParts(image);
    msgs[msgs.length - 1].images = [p.base64];
  }
  const res = await providerFetch("Ollama", `${base}/api/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: msgs, stream: true, options: { temperature: 0.2 } })
  });
  await ensureOk(res, "Ollama");
  let emitted = false;
  for await (const line of sseLines(res)) {
    try {
      const json = JSON.parse(line);
      if (json.message?.content) { emitted = true; onToken(json.message.content); }
    } catch {}
  }
  if (!emitted) throw new Error("Ollama returned an empty response. Confirm the model is running and retry.");
}

const ROUTES = { openai, openrouter, custom_openai: customOpenAI, anthropic, gemini, ollama };
const isModelError = (e) => /(model).*(not found|does not exist|404)|unknown model|no such model|not available for your account/i.test(String(e?.message || e));

export async function streamChat({ provider, settings, model, messages, image, onToken, signal }) {
  const fn = ROUTES[provider];
  if (!fn) throw new Error(`Unknown provider: ${provider}`);
  const chosenModel = model || settings.models?.[provider] || DEFAULT_MODELS[provider];
  try {
    await fn({ settings, model: chosenModel, messages, image, onToken, signal });
  } catch (e) {
    const fallback = DEFAULT_MODELS[provider];
    if (!signal?.aborted && fallback && fallback !== chosenModel && isModelError(e)) {
      onToken(`Model "${chosenModel}" was not available, so Solv retried with "${fallback}".\n\n`);
      await fn({ settings, model: fallback, messages, image, onToken, signal });
      return;
    }
    throw e;
  }
}

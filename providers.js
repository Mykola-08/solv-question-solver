// providers.js — unified streaming chat across providers.
// Each call yields incremental text via onToken(deltaString).
// messages: [{ role:'system'|'user'|'assistant', content:string }]
// image: optional data URL (e.g. "data:image/png;base64,....") for the last user turn.

export const DEFAULT_MODELS = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2",
  builtin: "gemini-nano"
};

const dataUrlParts = (dataUrl) => {
  // returns { mime, base64 }
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
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

// ---------- OpenAI ----------
async function openai({ settings, model, messages, image, onToken, signal }) {
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  if (image) {
    const last = msgs[msgs.length - 1];
    last.content = [
      { type: "text", text: last.content || "Solve the question in this image." },
      { type: "image_url", image_url: { url: image } }
    ];
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.keys.openai}` },
    body: JSON.stringify({ model, messages: msgs, stream: true, temperature: 0.2 })
  });
  await ensureOk(res, "OpenAI");
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) onToken(delta);
    } catch {}
  }
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
  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    try {
      const json = JSON.parse(line.slice(5).trim());
      if (json.type === "content_block_delta" && json.delta?.text) onToken(json.delta.text);
    } catch {}
  }
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
  const res = await fetch(url, {
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
  for await (const line of sseLines(res)) {
    if (!line.startsWith("data:")) continue;
    try {
      const json = JSON.parse(line.slice(5).trim());
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      if (text) onToken(text);
    } catch {}
  }
}

// ---------- Ollama (local) ----------
async function ollama({ settings, model, messages, image, onToken, signal }) {
  const base = (settings.ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  if (image) {
    const p = dataUrlParts(image);
    msgs[msgs.length - 1].images = [p.base64];
  }
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: msgs, stream: true, options: { temperature: 0.2 } })
  });
  await ensureOk(res, "Ollama");
  for await (const line of sseLines(res)) {
    try {
      const json = JSON.parse(line);
      if (json.message?.content) onToken(json.message.content);
    } catch {}
  }
}

const ROUTES = { openai, anthropic, gemini, ollama };

export async function streamChat({ provider, settings, model, messages, image, onToken, signal }) {
  const fn = ROUTES[provider];
  if (!fn) throw new Error(`Unknown provider: ${provider}`);
  const chosenModel = model || settings.models?.[provider] || DEFAULT_MODELS[provider];
  await fn({ settings, model: chosenModel, messages, image, onToken, signal });
}

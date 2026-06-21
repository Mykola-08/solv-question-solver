// config.js — shared config for content script + extension pages.
// Loaded as a classic script before the others; exposes globalThis.SOLV.
(() => {
  const SYSTEM_BASE = `You are Solv, a precise homework question-solver. The user is checking their own work and wants a fast, correct second opinion.

OUTPUT FORMAT — follow exactly, every time:
- Line 1 must be: ANSWER: <the final answer>
  • Multiple choice: write the letter, a closing paren, then the option text — e.g. "ANSWER: B) Paris". Pick exactly one.
  • True/False: "ANSWER: True" (or False).
  • Numeric: give the number with units, e.g. "ANSWER: 42 m/s".
- Then the explanation, controlled by the MODE below.
- The very last line must be exactly: CONFIDENCE: NN%   (NN = 0-100, your honest probability the answer is correct.)

Core rules:
- Be direct and confident. No filler, no hedging, no "as an AI", no apologies, no restating the question.
- If the question is genuinely ambiguous or context is missing, set ANSWER to "Need more info" and say in one line what is missing.
- Use light markdown (bold, lists, tables) and readable math.

MATH & SCIENCE — be rigorous:
- Work it step by step internally; double-check every arithmetic and algebra step before committing.
- Keep units, simplify fractions, and make the final result unambiguous.
- Write math readably: ×, ÷, √, π, ², ³, ≤, ≥, ≠, fractions as a/b. Avoid heavy LaTeX.`;

  // Modes — each ships a pre-written instruction appended to the system prompt.
  const MODES = [
    { id: "answer", label: "Answer only", desc: "Just the final answer",
      prompt: "MODE: Answer only. After the ANSWER line, output nothing else except the CONFIDENCE line — no explanation, no steps." },
    { id: "short", label: "Short", desc: "Answer + 1–2 line why",
      prompt: "MODE: Short. After the ANSWER line, add 1–2 short lines of justification (the key step only), then the CONFIDENCE line." },
    { id: "steps", label: "Full steps", desc: "Complete worked solution",
      prompt: "MODE: Full steps. After the ANSWER line, add a clear numbered worked solution — each key step in order. Tight, no fluff. Then the CONFIDENCE line." },
    { id: "hint", label: "Hint", desc: "Nudge, no answer",
      prompt: "MODE: Hint. Do NOT reveal the answer. Replace the ANSWER line with 'ANSWER: (hint only)'. Then give ONE focused hint (1–2 sentences) nudging toward the method. Then the CONFIDENCE line (how sure the hint points the right way)." },
    { id: "concept", label: "Concept", desc: "Explain the idea",
      prompt: "MODE: Concept. After the ANSWER line, explain the underlying concept simply and concretely (3–5 lines) and how it applies here. Then the CONFIDENCE line." }
  ];
  const buildSystem = (modeId, customPrompts) => {
    const base = SYSTEM_BASE;
    const custom = customPrompts && customPrompts[modeId];
    const mode = custom || (MODES.find((m) => m.id === modeId) || MODES[1]).prompt;
    return base + "\n\n" + mode;
  };

  // Curated model lists per provider. Users can also type a custom id.
  const MODELS = {
    openai: [
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini (balanced)" },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano (fast)" },
      { id: "gpt-5.5", label: "GPT-5.5 (strongest)" },
      { id: "gpt-4o", label: "GPT-4o (legacy vision)" },
      { id: "gpt-4o-mini", label: "GPT-4o mini (legacy)" }
    ],
    anthropic: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (vision)" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast)" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8 (if enabled)" }
    ],
    gemini: [
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (low cost)" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (vision)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (vision)" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (vision, reasoning)" }
    ],
    ollama: [
      { id: "llama3.2", label: "llama3.2" },
      { id: "llama3.2-vision", label: "llama3.2-vision (images)" },
      { id: "llava", label: "llava (images)" },
      { id: "qwen2.5", label: "qwen2.5" },
      { id: "gemma2", label: "gemma2" }
    ],
    builtin: [{ id: "gemini-nano", label: "Gemini Nano (on-device)" }],
    web_chatgpt: [], web_claude: [], web_gemini: []
  };
  const DEFAULT_MODELS = {
    openai: "gpt-5.4-mini", anthropic: "claude-sonnet-4-6", gemini: "gemini-2.5-flash",
    ollama: "llama3.2", builtin: "gemini-nano"
  };

  const PROVIDER_LABELS = {
    openai: "OpenAI · API", anthropic: "Claude · API", gemini: "Gemini · API",
    ollama: "Ollama · local", builtin: "Chrome AI",
    web_chatgpt: "ChatGPT · login", web_claude: "Claude · login", web_gemini: "Gemini · login"
  };
  const PROVIDER_GROUPS = [
    { label: "Your subscription (no key)", items: ["web_chatgpt", "web_claude", "web_gemini"] },
    { label: "API key", items: ["openai", "anthropic", "gemini"] },
    { label: "Local / on-device (no key)", items: ["ollama", "builtin"] }
  ];
  const WEB_PROVIDERS = new Set(["web_chatgpt", "web_claude", "web_gemini"]);
  const VISION_PROVIDERS = new Set(["openai", "anthropic", "gemini", "ollama", "builtin", "web_chatgpt", "web_claude", "web_gemini"]);

  // Map a raw error string to a friendly title + step-by-step fix.
  function friendlyError(msg, provider) {
    const m = (msg || "").toLowerCase();
    const site = { web_chatgpt: "chatgpt.com", web_claude: "claude.ai", web_gemini: "gemini.google.com" }[provider];
    if (/401|invalid.*key|incorrect.*key|authentication|x-api-key|unauthorized/.test(m))
      return { title: "API key not accepted", steps: [
        "Open Settings and re-paste your key (no spaces).",
        "Make sure the key matches the selected provider.",
        "Check the key is active and has credit/billing enabled." ], action: "options" };
    if (/429|rate limit|quota|insufficient_quota/.test(m))
      return { title: "Rate limited or out of quota", steps: [
        "Wait a few seconds and press Retry.",
        "Check your provider account has remaining credit/quota.",
        "Try a cheaper model in the model chooser." ] };
    if (/(model).*(not found|does not exist|404)|unknown model|no such model/.test(m))
      return { title: "Model not found", steps: [
        provider === "ollama" ? "Run: ollama pull <model> (e.g. ollama pull llama3.2)." : "Pick the recommended default model in Settings, then test again.",
        provider === "anthropic" ? "Opus access can be account-limited; Sonnet is the safest default." : "Some model ids are account, region, or API-version limited.",
        "Make sure the model id is spelled exactly right." ], action: "options" };
    if (/image.*(large|invalid|unsupported)|unsupported image|capture.*again/.test(m))
      return { title: "Image couldn't be sent", steps: [
        "Capture a smaller region around just the question.",
        "Use PNG, JPEG, WebP, or GIF.",
        "If the page is zoomed in, zoom out and capture again." ] };
    if (WEB_PROVIDERS.has(provider) && /(attach|image).*logged-in|couldn't attach the image|file input|drop/.test(m))
      return { title: "Couldn't attach image to the AI tab", steps: [
        "Open the logged-in AI tab and make sure image upload is available for your account.",
        "Turn on Settings → briefly focus the AI tab while solving, then Retry.",
        "For the most reliable image solving, switch to an API vision provider." ] };
    if (WEB_PROVIDERS.has(provider) && /(log ?in|logged in|chat box|sign|session)/.test(m))
      return { title: `Sign in to ${site}`, steps: [
        `Open the ${site} tab Solv created and log in.`,
        "Keep that tab open, then press Retry here.",
        "If it still fails the site layout may have changed — switch to an API provider meanwhile." ] };
    if (provider === "ollama" && /(failed to fetch|networkerror|load failed|connection|refused)/.test(m))
      return { title: "Can't reach Ollama", steps: [
        "Install Ollama from ollama.com and run: ollama serve",
        "Pull a model: ollama pull llama3.2",
        "Confirm the URL in Settings (default http://localhost:11434)." ], action: "options" };
    if (provider === "builtin" && /(not available|unavailable|languagemodel)/.test(m))
      return { title: "Chrome built-in AI unavailable", steps: [
        "Use a recent Chrome (Canary/Dev may be needed).",
        "Enable the Prompt API / Gemini Nano at chrome://flags.",
        "First use downloads the model — wait, then Retry." ] };
    if (/failed to fetch|networkerror|load failed/.test(m))
      return { title: "Network or permission error", steps: [
        "Check your internet connection.",
        "Reload the page and try again.",
        WEB_PROVIDERS.has(provider) ? `Make sure the ${site} tab is open and logged in.` : "Verify the provider host is allowed." ] };
    return { title: "Something went wrong", steps: [msg || "Unknown error.", "Press Retry, or switch provider/model in Settings."], action: "options" };
  }

  // Best-effort LaTeX -> readable unicode (no heavy renderer needed).
  const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ", i: "ⁱ" };
  const SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };
  const GREEK = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω", Pi: "Π" };
  function latexToReadable(s) {
    if (!s) return s;
    let t = s;
    t = t.replace(/\\\[|\\\]|\\\(|\\\)/g, "");
    t = t.replace(/\$\$?/g, "");
    t = t.replace(/\\left|\\right|\\,|\\!|\\;|\\ /g, "");
    t = t.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)");
    t = t.replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)");
    t = t.replace(/\\(times|cdot|div|pm|mp|leq|geq|neq|approx|infty|to|rightarrow|sum|int|degree|circ)/g,
      (_, w) => ({ times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", leq: "≤", geq: "≥", neq: "≠", approx: "≈", infty: "∞", to: "→", rightarrow: "→", sum: "∑", int: "∫", degree: "°", circ: "°" }[w]));
    t = t.replace(/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|rho|sigma|phi|omega|Delta|Sigma|Omega|Pi)/g, (_, w) => GREEK[w] || w);
    t = t.replace(/\^\{([^{}]+)\}/g, (_, g) => [...g].every((c) => SUP[c]) ? [...g].map((c) => SUP[c]).join("") : "^(" + g + ")");
    t = t.replace(/\^([0-9])/g, (_, d) => SUP[d]);
    t = t.replace(/_\{([^{}]+)\}/g, (_, g) => [...g].every((c) => SUB[c]) ? [...g].map((c) => SUB[c]).join("") : "_(" + g + ")");
    t = t.replace(/_([0-9])/g, (_, d) => SUB[d]);
    t = t.replace(/\\text\s*\{([^{}]+)\}/g, "$1");
    t = t.replace(/\\boxed\s*\{([^{}]+)\}/g, "【$1】");
    return t;
  }

  // ---------- shared rendering ----------
  const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  function renderTable(block) {
    const rows = block.trim().split("\n").map((r) => r.trim());
    if (rows.length < 2 || !/^\|?\s*:?-{2,}/.test(rows[1])) return null;
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const th = cells(rows[0]).map((c) => `<th>${c}</th>`).join("");
    const trs = rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
    return `<table class="solv-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  }
  function renderMd(text) {
    const fences = [];
    let h = escapeHtml(latexToReadable(text) + "\n").replace(/```([\s\S]*?)```/g, (_, c) => {
      fences.push(`<pre>${c.replace(/^\n+|\n+$/g, "")}</pre>`); return `\x00${fences.length - 1}\x00`;
    });
    h = h.replace(/(?:^|\n)((?:\|?.*\|.*\n){2,})/g, (m, blk) => { const t = renderTable(blk); return t ? "\n" + t : m; });
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");
    h = h.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/(^|\n)\s*#{3,4}\s*(.+)/g, '$1<div class="solv-h2">$2</div>');
    h = h.replace(/(^|\n)\s*#{1,2}\s*(.+)/g, '$1<div class="solv-h1">$2</div>');
    h = h.replace(/(^|\n)\s*&gt;\s?(.+)/g, '$1<blockquote>$2</blockquote>');
    h = h.replace(/(^|\n)\s*[-*]\s+(.+)/g, '$1<div class="solv-li">• $2</div>');
    h = h.replace(/(^|\n)\s*(\d+)\.\s+(.+)/g, '$1<div class="solv-li">$2. $3</div>');
    h = h.replace(/(^|\n)\s*---+\s*(?=\n|$)/g, '$1<hr>');
    h = h.replace(/\n/g, "<br>");
    h = h.replace(/(<\/(?:div|pre|table|blockquote|hr)>)<br>/g, "$1");
    h = h.replace(/<br>(<(?:div|pre|table|blockquote|hr))/g, "$1");
    h = h.replace(/\x00(\d+)\x00/g, (_, i) => fences[+i]);
    return h;
  }
  const parseConfidence = (t) => { const m = /CONFIDENCE:\s*(\d{1,3})\s*%/i.exec(t); return m ? Math.min(100, +m[1]) : null; };
  const stripConfidence = (t) => t.replace(/\n?\s*CONFIDENCE:\s*\d{1,3}\s*%\s*$/i, "").trim();
  const confTone = (c) => (c == null ? "" : c >= 80 ? "good" : c >= 60 ? "warn" : "bad");

  // Parse the model output into { answer, choice, choiceText, rest, confidence }.
  function parseResult(text) {
    const confidence = parseConfidence(text);
    const body = stripConfidence(text).replace(/^Model "[^"]+" was not available, so Solv retried with "[^"]+"\.\s*/i, "");
    const lines = body.split("\n");
    let answer = "", rest = "";
    const m = body.match(/^[ \t>*_-]*(?:\*\*)?\s*(?:final\s+answer|answer|hint)\s*(?:\*\*)?\s*[:\-]\s*(.*)$/im);
    if (m) {
      answer = (m[1] || "").trim();
      rest = body.slice(0, m.index).trim() + "\n" + body.slice(m.index + m[0].length).trim();
      rest = rest.trim();
      // if answer line was empty (hint placeholder), take the next non-empty line as answer
      if (!answer || /^\(?\s*hint\s*only\s*\)?$/i.test(answer)) {
        const after = body.slice(m.index + m[0].length).split("\n").map((l) => l.trim()).filter(Boolean);
        answer = after[0] || answer || "See reasoning";
      }
    } else {
      const idx = lines.findIndex((l) => l.trim());
      answer = idx < 0 ? body : lines[idx].trim();
      rest = idx < 0 ? "" : lines.slice(idx + 1).join("\n").trim();
    }
    // strip common reasoning labels at the start of rest
    rest = rest.replace(/^(?:\*\*)?\s*(why|reasoning|explanation|steps|because|solution)\s*(?:\*\*)?\s*[:\-]\s*/i, "").trim();
    if (rest === answer) rest = ""; // avoid duplicating the answer as "reasoning"
    // multiple-choice letter detection
    let choice = null, choiceText = null;
    const cm = answer.match(/^\(?([A-Ea-e])\)?\s*[).:\-]\s*(.+)$/) || answer.match(/^\(?([A-Ea-e])\)?\.?$/);
    if (cm) { choice = cm[1].toUpperCase(); choiceText = (cm[2] || "").trim(); }
    return { answer, choice, choiceText, rest, confidence };
  }
  // kept for backward compat
  const extractAnswer = (text) => { const r = parseResult(text); return { answer: r.answer, rest: r.rest }; };

  globalThis.SOLV = {
    SYSTEM_BASE, MODES, buildSystem, MODELS, DEFAULT_MODELS,
    PROVIDER_LABELS, PROVIDER_GROUPS, WEB_PROVIDERS, VISION_PROVIDERS,
    friendlyError, latexToReadable,
    render: { escapeHtml, md: renderMd, parseConfidence, stripConfidence, extractAnswer, parseResult, confTone }
  };
})();

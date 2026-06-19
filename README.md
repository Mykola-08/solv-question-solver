# Solv — Inline Question Solver (Chrome extension)

Select text or screenshot a question on any page and get a direct AI answer in a small
overlay — no copy-paste, no tab switching. Built for checking your own homework.

Use **whatever access you already have** — four kinds of backend:
- **Your subscription (no key)** — drives your already-logged-in **ChatGPT / Claude / Gemini** tab.
  Uses the plan you already pay for. Solv types the question into the web app, best-effort attaches screenshots/images,
  and reads the reply back.
- **API key** — OpenAI, Anthropic (Claude), or Google Gemini (supports image questions)
- **Local** — Ollama on `localhost` (free, offline, private)
- **On-device** — Chrome's built-in AI (Gemini Nano), no key at all

### Two surfaces
- **In-page overlay** — select text / screenshot a region → answer floats on the page. Draggable, Esc to close.
- **Side panel** — a full chat assistant (open from the popup → *Side panel*, or the ⇥ button on the overlay).
  Type or **paste/attach an image**, keep a running conversation, switch provider/model/mode live.

### Modes (pre-written prompts, fully editable)
Pick per question: **Answer only**, **Short** (answer + 1–2 lines), **Full steps** (worked solution),
**Hint** (nudge, no answer), **Concept** (explains the idea). Each mode is a prompt sent to the AI so the
output comes out the way you want — edit any of them in **Settings → Mode prompts**, or set a default mode.

### Model chooser
Every provider has a model dropdown (curated list + “Custom…”) in the popup, the overlay, and the side panel.
Math is handled carefully: the prompt forces step-checking and a clear final answer, and LaTeX is rendered to
readable math (fractions, √, π, exponents, ≤ ≥ ≠ …).

### Smart result display
The AI answers in a fixed structure (`ANSWER: …` then reasoning then `CONFIDENCE: NN%`), which Solv parses so you get:
- the **answer up front** in a highlighted card — not a wall of text;
- for **multiple-choice**, a big **letter badge** (A/B/C/D) with the option text, so you see the pick instantly;
- a compact **confidence % badge** (green/amber/red) instead of a long bar;
- reasoning tucked in a collapsible **“Show reasoning”**;
- an automatic **independent double-check** when confidence is low (flags agree/disagree);
- the provider·model that answered, plus **Regenerate / Copy / Verify** and a follow-up box.

Errors show a **step-by-step “how to fix”** with a Retry button. The background uses a keepalive so long or
slow requests don’t drop with “connection closed”, and partial answers are kept if the worker is recycled.

## Install (Load unpacked)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select this folder (`ai test solver`)
4. Click the Solv icon → pick a provider → add a key in **Settings** (or choose Ollama / Chrome AI)
5. Use **Settings → Test** next to a provider to confirm the key/model or Ollama connection before solving.

## Validate and package

No build step is required. Before publishing, run:

```bash
node scripts/validate-extension.mjs
node scripts/package-extension.mjs
```

The package script writes a Chrome Web Store ZIP to `dist/`. Store listing copy, privacy text,
review notes, and asset requirements live in `store/`; manual smoke tests live in `QA.md`.

## Use

- **Select text** on a page → click the floating **Solve** pill, or press `Alt+A`
- **Screenshot a question/diagram** → press `Alt+S`, drag a box (vision model required)
- Right-click selected text → **Solve "…" with Solv**

The overlay streams the answer, shows a **confidence %**, and — when confidence is below your
threshold — silently runs an **independent second solve** and flags any disagreement. You can also
hit **Verify** anytime, ask a **follow-up**, or **Copy** the answer. Drag the panel by its header.

## Backends notes

| Provider | Key needed | Images |
|---|---|---|
| ChatGPT / Claude / Gemini (your login) | no — uses your subscription | best-effort via web upload |
| OpenAI | yes | yes (multimodal models) |
| Anthropic | yes | yes (Claude) |
| Gemini | yes | yes |
| Ollama | no (local) | use a vision model: `llava`, `llama3.2-vision` |
| Chrome built-in | no | depends on Chrome version |

**Login providers:** keep a tab signed in at chatgpt.com / claude.ai / gemini.google.com. The first
time you solve, Solv opens that tab in the background, types your question, and streams the reply back
into the overlay. It reads the reply with a **MutationObserver**, so it keeps working even while that
tab is in the background (Chrome throttles background-tab *timers*, but DOM updates and observers still
fire — that’s why the old timer-polling only completed when you focused the tab). For stubborn sites,
enable **Settings → “briefly focus the AI tab while solving”** for guaranteed capture. If it can’t find
the chat box, make sure you’re logged in and retry — these read the live page DOM, so a major site
redesign can need a selector update in `web-driver.js`.

For screenshots/images with login providers, Solv tries file input, paste, and drag/drop attachment
inside the logged-in tab. Some accounts/sites block background attachment; if that happens, enable
brief focus while solving or use an API vision provider for the most reliable image flow.

- Get keys: [OpenAI](https://platform.openai.com/api-keys) ·
  [Anthropic](https://console.anthropic.com/settings/keys) ·
  [Google AI Studio](https://aistudio.google.com/apikey)
- Ollama: install from [ollama.com](https://ollama.com), run `ollama serve`, `ollama pull llama3.2`.
- Chrome built-in AI: needs a recent Chrome with the Prompt API / Gemini Nano enabled (see `chrome://flags`).

## Privacy

Keys live only in `chrome.storage.local` on your machine. Questions go **directly** from your
browser to the provider you selected (or stay fully local with Ollama / Chrome AI). Nothing routes
through any server of ours — there isn't one.

## Files

- `manifest.json` — MV3 config (side panel, commands, host permissions)
- `config.js` — shared config: modes/prompts, model lists, friendly-error help, markdown + LaTeX rendering
- `background.js` — provider routing, streaming, screenshot capture, web-login solving, side panel, menus/shortcuts
- `providers.js` — unified `streamChat()` for OpenAI / Anthropic / Gemini / Ollama
- `web-driver.js` — drives your logged-in ChatGPT / Claude / Gemini tab
- `content.js` / `content.css` — selection pill, region capture, the overlay UI
- `builtin-ai.js` — main-world bridge to Chrome's on-device LanguageModel
- `sidepanel.html|js` — the side-panel chat assistant
- `popup.html|js` — quick provider/model switch + open side panel
- `options.html|js` — keys, models, thresholds, default mode, editable mode prompts, setup/troubleshooting
- `build_icons.py` — regenerates `icons/`
- `plan.html` — the design/plan document
- `scripts/validate-extension.mjs` — npm-free manifest, syntax, icon, and policy-readiness checks
- `scripts/package-extension.mjs` — creates a clean publish ZIP in `dist/`
- `store/` — Chrome Web Store listing, privacy, review notes, and asset checklist
- `QA.md` — manual release smoke-test checklist

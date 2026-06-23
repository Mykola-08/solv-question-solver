// web-driver.js — injected into a logged-in chatgpt.com / claude.ai / gemini.google.com
// tab. Types the prompt into the composer, submits, and streams the assistant's
// reply back to the background via chrome.runtime.sendMessage.
(() => {
  if (window.__solvWebDriver) return;
  window.__solvWebDriver = true;

  const CONFIG = {
    web_chatgpt: {
      composer: ["#prompt-textarea", 'div[contenteditable="true"]#prompt-textarea', 'textarea[data-id]', 'div.ProseMirror[contenteditable="true"]'],
      file: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
      send: ['button[data-testid="send-button"]', 'button[aria-label*="Send"]'],
      stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
      message: ['div[data-message-author-role="assistant"]', "div.markdown.prose"]
    },
    web_claude: {
      composer: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
      file: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
      send: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]', 'button[aria-label*="Send"]'],
      stop: ['button[aria-label*="Stop"]'],
      message: ['div.font-claude-message', '[data-testid="assistant-message"]', "div.font-claude-response"]
    },
    web_gemini: {
      composer: ["div.ql-editor[contenteditable]", 'div[contenteditable="true"][role="textbox"]', "rich-textarea div[contenteditable]"],
      file: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
      send: ['button[aria-label*="Send"]', "button.send-button", 'button[mattooltip*="Send"]'],
      stop: ['button[aria-label*="Stop"]'],
      message: ["message-content", ".model-response-text", "div.markdown"]
    }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (selectors) => {
    for (const s of selectors) { const el = document.querySelector(s); if (el) return el; }
    return null;
  };
  const pickAll = (selectors) => {
    for (const s of selectors) { const els = document.querySelectorAll(s); if (els.length) return [...els]; }
    return [];
  };

  function setComposerText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // contenteditable — set text as paragraphs and fire input
      el.innerHTML = "";
      for (const line of text.split("\n")) {
        const p = document.createElement("p");
        p.textContent = line || "";
        el.appendChild(p);
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
    }
  }

  async function dataUrlToFile(dataUrl) {
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(dataUrl || "")) {
      throw new Error("The image data was invalid. Capture or attach it again.");
    }
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    return new File([blob], `solv-question.${ext}`, { type: blob.type || "image/jpeg" });
  }

  function dispatchFileInput(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchPaste(target, file) {
    for (const el of [target, document]) {
      const dt = new DataTransfer();
      dt.items.add(file);
      el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    }
  }

  function dispatchDrop(target, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    target.dispatchEvent(new DragEvent("dragenter", opts));
    target.dispatchEvent(new DragEvent("dragover", opts));
    target.dispatchEvent(new DragEvent("drop", opts));
  }

  async function attachImage(cfg, composer, image) {
    if (!image) return true;
    const file = await dataUrlToFile(image);
    const inputs = pickAll(cfg.file || ['input[type="file"]']).filter((el) => !el.disabled);
    for (const input of inputs) {
      try {
        dispatchFileInput(input, file);
        await sleep(900);
        return true;
      } catch {}
    }
    try {
      dispatchPaste(composer, file);
      await sleep(900);
      return true;
    } catch {}
    try {
      dispatchDrop(composer, file);
      await sleep(900);
      return true;
    } catch {}
    return false;
  }

  const composerText = (el) => (el.value !== undefined ? el.value : el.innerText) || "";
  const isEmpty = (el) => composerText(el).trim().length === 0;
  const sendEnabled = (btn) => btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true" && btn.offsetParent !== null;
  function pressEnter(el) {
    const o = { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 };
    el.dispatchEvent(new KeyboardEvent("keydown", o));
    el.dispatchEvent(new KeyboardEvent("keypress", o));
    el.dispatchEvent(new KeyboardEvent("keyup", o));
  }
  // Robustly send: re-fire input so the framework enables the button, click it,
  // and confirm the composer actually cleared. Retry a few times (fixes Gemini
  // sometimes leaving the text sitting in the box).
  async function submit(cfg, el) {
    const tryFormSubmit = () => {
      const form = el.closest?.("form");
      if (!form) return false;
      try {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
        return true;
      } catch { return false; }
    };
    const tryNearbyButton = () => {
      const root = el.closest?.("form") || el.parentElement || document;
      const buttons = [...(root.querySelectorAll?.("button") || [])].filter(sendEnabled);
      const likely = buttons.find((b) => /send|submit|arrow|up/i.test(`${b.ariaLabel || ""} ${b.title || ""} ${b.textContent || ""}`)) || buttons.at(-1);
      if (!likely) return false;
      likely.click();
      return true;
    };
    for (let attempt = 0; attempt < 8; attempt++) {
      el.focus();
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(180);
      const btn = pick(cfg.send);
      if (sendEnabled(btn)) btn.click();
      else if (!tryNearbyButton() && !tryFormSubmit()) pressEnter(el);
      if (attempt >= 3) pressEnter(el);
      await sleep(260);
      if (isEmpty(el)) return true;        // composer cleared → it sent
      if (pick(cfg.stop)) return true;      // a stop button appeared → it's responding
    }
    return isEmpty(el);
  }

  // Resolve with the newly-added assistant message element. Uses a MutationObserver
  // (fires on real DOM changes even in a throttled background tab) plus a slow poll.
  function waitForNewMessage(cfg, baseline) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (el) => { if (done) return; done = true; obs.disconnect(); clearInterval(iv); clearTimeout(to); resolve(el); };
      const check = () => {
        const msgs = pickAll(cfg.message);
        if (msgs.length > baseline) finish(msgs[msgs.length - 1]);
      };
      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true });
      const iv = setInterval(check, 1000);            // backup tick (throttled in bg, that's fine)
      const to = setTimeout(() => finish(null), 90000);
      check();
    });
  }

  // Stream the answer text as it grows; finish when it stops growing and no stop
  // button is present. Timing uses Date.now() so throttling can't stall completion.
  function streamMessage(cfg, target, send) {
    return new Promise((resolve) => {
      let prev = "", lastGrow = Date.now(), done = false, debounce = null;
      const start = Date.now();
      const STABLE_MS = 1600, MAX_MS = 240000;
      const finish = () => {
        if (done) return; done = true; obs.disconnect(); clearInterval(iv); clearTimeout(debounce);
        if (!prev) send("solv-web-error", { error: "Got an empty response — try retrying." });
        else send("solv-web-done", {});
        resolve();
      };
      const scheduleFinish = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { if (prev && !pick(cfg.stop)) finish(); else scheduleFinish(); }, STABLE_MS);
      };
      const emit = () => {
        const cur = (target.innerText || "").trim();
        if (cur.length > prev.length) { send("solv-web-token", { delta: cur.slice(prev.length) }); prev = cur; lastGrow = Date.now(); scheduleFinish(); }
      };
      const obs = new MutationObserver(emit);
      obs.observe(target, { childList: true, subtree: true, characterData: true });
      // backup tick: catches any growth the observer missed and enforces the hard cap
      const iv = setInterval(() => {
        emit();
        if (prev && !pick(cfg.stop) && Date.now() - lastGrow > STABLE_MS) finish();
        if (Date.now() - start > MAX_MS) finish();
      }, 1000);
      emit(); scheduleFinish();
    });
  }

  async function run({ requestId, provider, prompt, image }) {
    const cfg = CONFIG[provider];
    const send = (type, extra) => chrome.runtime.sendMessage({ type, requestId, ...extra });
    try {
      const composer = pick(cfg.composer);
      if (!composer) {
        send("solv-web-error", { error: `Couldn't find the chat box. Make sure you're logged in to this site in the opened tab, then retry.` });
        return;
      }
      const baseline = pickAll(cfg.message).length;
      setComposerText(composer, prompt);
      if (image) {
        const attached = await attachImage(cfg, composer, image);
        if (!attached) {
          send("solv-web-error", { error: "Couldn't attach the image to the logged-in AI tab. Turn on Settings → briefly focus the AI tab while solving, or use an API vision provider." });
          return;
        }
      }
      const sent = await submit(cfg, composer);
      if (!sent) {
        send("solv-web-error", { error: "Typed the question but couldn't trigger send. Click the send button in the tab once, then retry — the site may have changed its send control." });
        return;
      }

      // Wait for the new assistant message. Event-driven (MutationObserver) so it
      // works even when the tab is in the background and timers are throttled.
      const target = await waitForNewMessage(cfg, baseline);
      if (!target) { send("solv-web-error", { error: "No response detected (the site UI may have changed, or you need to be logged in)." }); return; }

      // Stream the answer via MutationObserver + a slow backup tick; Date.now()
      // (not throttled) drives the "stopped growing" completion check.
      await streamMessage(cfg, target, send);
    } catch (e) {
      send("solv-web-error", { error: String(e?.message || e) });
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "solv-web-run") { run(msg); sendResponse({ ok: true }); }
    if (msg?.type === "solv-web-ping") { sendResponse({ ok: true }); }
    return true;
  });
})();

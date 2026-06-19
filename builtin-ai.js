// builtin-ai.js — runs in the page's MAIN world to reach Chrome's on-device
// Prompt API (LanguageModel / Gemini Nano). Bridges to the content script via
// window.postMessage.
(() => {
  if (window.__solvBuiltin) return;
  window.__solvBuiltin = true;

  const reply = (id, type, extra) =>
    window.postMessage({ source: "solv-builtin", id, type, ...extra }, "*");

  async function dataUrlToBitmap(dataUrl) {
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(dataUrl || "")) {
      throw new Error("Invalid image data. Capture or attach the image again.");
    }
    if (dataUrl.length > 12_000_000) throw new Error("Image is too large. Capture a smaller region or use a smaller file.");
    const blob = await (await fetch(dataUrl)).blob();
    return await createImageBitmap(blob);
  }

  function getAPI() {
    // Chrome exposes either a global `LanguageModel` or `window.ai.languageModel`.
    if (typeof LanguageModel !== "undefined") return LanguageModel;
    if (window.ai?.languageModel) return window.ai.languageModel;
    return null;
  }

  async function solve({ id, messages, image }) {
    const API = getAPI();
    if (!API) {
      reply(id, "error", {
        error: "Chrome built-in AI not available. Enable it at chrome://flags (Prompt API for Gemini Nano) on a recent Chrome, then reload."
      });
      return;
    }
    try {
      let availability = "available";
      try {
        if (typeof API.availability === "function") availability = await API.availability();
        else if (typeof API.capabilities === "function") availability = (await API.capabilities())?.available;
      } catch {}
      if (availability === "unavailable" || availability === "no") {
        reply(id, "error", { error: "Gemini Nano is unavailable on this device." });
        return;
      }
      if (availability === "downloadable" || availability === "downloading" || availability === "after-download") {
        reply(id, "token", { text: "(downloading on-device model — first run can take a minute)\n\n" });
      }

      const system = messages.find((m) => m.role === "system")?.content;
      const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";

      const createOpts = {};
      if (system) createOpts.initialPrompts = [{ role: "system", content: system }];
      if (image) createOpts.expectedInputs = [{ type: "image" }];

      const session = await API.create(createOpts);

      let promptInput = lastUser;
      if (image) {
        const bmp = await dataUrlToBitmap(image);
        promptInput = [{ role: "user", content: [
          { type: "text", value: lastUser || "Solve the question in this image." },
          { type: "image", value: bmp }
        ] }];
      }

      const stream = session.promptStreaming(promptInput);
      let prev = "";
      for await (const chunk of stream) {
        // Some Chrome versions yield cumulative text, others yield deltas.
        if (chunk.startsWith(prev) && prev) { reply(id, "token", { text: chunk.slice(prev.length) }); prev = chunk; }
        else { reply(id, "token", { text: chunk }); prev += chunk; }
      }
      session.destroy?.();
      reply(id, "done", {});
    } catch (e) {
      reply(id, "error", { error: String(e?.message || e) });
    }
  }

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.source !== "solv" || d.type !== "builtin-solve") return;
    solve(d);
  });
})();

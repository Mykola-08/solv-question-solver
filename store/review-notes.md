# Chrome Web Store Review Notes

Solv is a Manifest V3 extension for checking study questions inline with a second-opinion tutor response. Users trigger every solve action explicitly by selecting text, using the context menu, pressing a shortcut, typing in the side panel, pasting an image, or dragging a screenshot region.

## Data Flow
- API providers: selected text, typed questions, and optional images are sent directly to the selected provider endpoint.
- Local provider: Ollama requests go to `localhost` or `127.0.0.1`.
- On-device provider: Chrome built-in AI runs through Chrome's local Prompt API when available.
- Login providers: when selected, Solv injects `web-driver.js` into the user's already logged-in ChatGPT, Claude, or Gemini tab to submit the prompt, best-effort attach images through that site's own upload mechanisms, and read the streamed answer from the page DOM.

## Remote Code
Solv does not load remote JavaScript, CSS, WASM, or executable configuration. All extension logic is contained in the submitted package.

## Page Access
Solv declares broad page matching so users can use the same selected-text, context-menu, keyboard shortcut, and screenshot-region flow on ordinary pages they choose. The extension does not automatically send page content. It processes selected, typed, pasted, attached, or captured content only after a user action.

## Login Provider Limitation
The logged-in ChatGPT/Claude/Gemini providers depend on those websites' DOM and upload controls. Image attachment is best-effort and may need selector updates if those websites change. Users can switch to API, local, or on-device providers at any time.

## Privacy
Solv has no backend service. It stores settings and optional API keys locally in `chrome.storage.local`. It does not sell data, use data for advertising, or allow human review of user content.

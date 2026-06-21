# Solv Privacy Disclosure

Use this text in the Chrome Web Store privacy fields.

Solv is an inline study-question second-opinion tutor. It processes only content the user explicitly selects, types, pastes, attaches, or captures.

Data handled:
- Selected page text when the user chooses to solve it.
- Screenshot regions when the user starts a capture.
- User-entered side-panel prompts and attached images.
- Provider settings, model choices, UI preferences, and optional API keys stored in `chrome.storage.local`.

How data is used:
- User content is sent directly from the browser to the provider the user selected: OpenAI, Anthropic, Google Gemini, local Ollama, Chrome built-in AI, or the user's logged-in ChatGPT/Claude/Gemini web session.
- The extension does not send user content to a Solv server. There is no Solv server.
- API keys and settings are stored locally in the user's browser.
- The extension does not load remote executable code.

Data sharing and sale:
- Solv does not sell user data.
- Solv does not use user data for advertising.
- Solv does not allow humans to read user content.
- Solv transfers user content only as necessary to provide the user-requested answer through the selected AI provider.

Limited Use statement:
Solv's use of information complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide or improve the extension's single purpose: giving a second-opinion tutor response for user-selected study questions.

Retention:
- Settings and API keys remain in Chrome local storage until the user changes settings, clears extension data, or uninstalls the extension.
- Conversation handoffs between overlay and side panel are temporary and are cleared after use.

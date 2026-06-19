# Solv - Inline Question Solver

## Short Description
Select or capture study questions and get a fast second-opinion AI answer inline.

## Full Description
Solv helps students and self-learners check their work without switching tabs. Select question text on any page, or capture a region with a diagram or handwritten prompt, and Solv shows a compact answer overlay on the page. You can continue the conversation in the side panel, copy the answer, regenerate it, or run an independent verification pass when confidence is low.

Main features:
- Select-to-solve overlay for text questions.
- Region capture for image and diagram questions with vision-capable providers.
- Side panel chat for follow-up questions.
- Answer-first formatting with confidence and optional reasoning.
- Provider choices: your API key, local Ollama, Chrome built-in AI, or your already logged-in ChatGPT/Claude/Gemini tab.
- Logged-in ChatGPT/Claude/Gemini image questions are supported best-effort through the site's own attachment controls; API vision providers are recommended for the most reliable image flow.
- Built-in connection tests for API keys and local Ollama from Settings.
- Keys and settings stay in `chrome.storage.local` on the user's device.

## Single Purpose
Solv's single purpose is to help users get a second-opinion answer for study questions they explicitly select, type, paste, or capture.

## Category
Productivity or Education.

## Permission Justification
- `storage`: saves provider settings, API keys, model choices, overlay preferences, and side-panel handoffs locally.
- `activeTab`: enables solving on the current tab only when the user selects text, uses a shortcut, or starts a screenshot capture.
- `scripting`: injects the web-session driver into the user's logged-in ChatGPT, Claude, or Gemini tab when that provider is selected.
- `contextMenus`: adds right-click actions for solving selected text or starting a region capture.
- `tabs`: finds or opens the user's logged-in AI tab and restores focus when needed.
- `sidePanel`: provides the optional side-panel chat continuation surface.

## Host Permission Justification
- `https://api.openai.com/*`, `https://api.anthropic.com/*`, `https://generativelanguage.googleapis.com/*`: sends user-requested questions directly to the selected API provider.
- `http://localhost/*`, `http://127.0.0.1/*`: supports local Ollama models.
- `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*`: supports the optional "your login" providers by typing into and reading from the user's existing AI web session.

## Privacy Disclosure For Dashboard
Solv stores settings and optional API keys locally in Chrome storage. When a user asks Solv to answer a question, the selected text, typed prompt, pasted image, or captured screenshot is sent only to the provider the user selected, or to local/on-device AI if selected. Solv does not operate a server, sell user data, use data for advertising, or allow human review of user content.

## Review Notes
The extension contains all executable code in the submitted package. It does not load remote scripts or execute remotely hosted code. Network requests are limited to user-selected AI providers, local Ollama, and the optional logged-in AI websites listed in host permissions.

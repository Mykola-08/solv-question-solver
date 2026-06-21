# Solv QA Checklist

Run before publishing a new ZIP.

## Automated
- `node scripts/validate-extension.mjs`
- `node scripts/generate-store-assets.mjs`
- `node scripts/package-extension.mjs`
- Upload `dist/solv-<version>.zip` to the Chrome Developer Dashboard as a draft upload validation.

## Manual Chrome Smoke Test
- Load unpacked from `chrome://extensions`.
- Open popup, change provider/model, save, reopen popup, confirm persistence.
- Open Settings, change default mode and overlay preferences, save, reload Settings, confirm persistence.
- In Settings, use the Test buttons for configured API providers and Ollama; confirm success/failure messages are clear.
- On a normal web page, select text and click the Solve pill.
- Use `Alt+A` with selected text.
- Use `Alt+S`, drag a region, and confirm the overlay appears.
- Capture a large region and confirm Solv still sends a compressed image or shows a clear image error.
- With a logged-in web provider selected, send a screenshot question and confirm it attempts web upload; if the site blocks it, confirm the error suggests focus mode or API vision.
- With an API provider missing its key, confirm the setup error explains how to fix it.
- Open the side panel from popup and from overlay handoff.
- Ask a follow-up in the side panel.
- Test Copy, Regenerate, and Verify controls in the overlay.
- Try a restricted page such as `chrome://extensions` and confirm no noisy failure.
- Test Ollama while stopped and confirm the friendly "Can't reach Ollama" message.
- Test a login provider while signed out and confirm the sign-in guidance appears.

## Store Review Check
- Confirm `store/listing.md` matches the current feature set.
- Confirm `store/privacy.md` matches the dashboard privacy disclosures.
- Confirm `store/assets/screenshot-1.png` through `screenshot-5.png` are current, 1280x800, and not visually cropped.
- Confirm `store/assets/promo-small.png` is 440x280 and `store/assets/promo-marquee.png` is 1400x560.
- Confirm listing language uses second-opinion tutor positioning and does not imply automated page reading or a Solv backend.

# Chrome Web Store Asset Checklist

Required:
- Store icon: `icons/icon128.png` at 128x128 PNG.
- Screenshots: `store/assets/screenshot-1.png` through `screenshot-5.png`, 1280x800 PNG, square corners, full bleed.
- Small promo tile: `store/assets/promo-small.png`, 440x280 PNG.

Optional:
- Marquee promo tile: `store/assets/promo-marquee.png`, 1400x560 PNG.
- YouTube demo video URL.

Recommended screenshots for Solv:
- In-page overlay answering selected text.
- Region screenshot capture in progress.
- Side-panel follow-up chat.
- Settings page showing provider choices.
- Friendly setup/error card.

Keep screenshots current with the submitted extension version and avoid dense marketing text.

Regenerate deterministic assets with:

```bash
node scripts/generate-store-assets.mjs
```

# Meme Generator (Modernized Fork)

A free online meme maker, rebuilt for touch: add text layers to any image and **drag them into place**, **resize by dragging the corner handle or pinching with two fingers**. No sign-up, no uploads to a server — everything runs in your browser.

**Live site:** https://tonywoo.github.io/meme-generator/

Forked from [georapbox/meme-generator](https://github.com/georapbox/meme-generator) (MIT). This fork keeps the original template library and fonts, and replaces the editor with a layer-based, mobile-first implementation.

## Features

- 92 built-in meme templates, plus upload / paste / drag-and-drop your own image, or start from a blank canvas (1:1, 4:5, 16:9, 9:16)
- Unlimited text layers: drag to move, corner-handle drag or two-finger pinch to resize
- Rotate text: drag the top handle, use the slider, or tap the ±15° buttons
- Click the red × on the image to delete a layer directly; double-click (or double-tap) a layer to edit it in place on the image
- Quick colors: preset swatches and a color picker in the floating bar under the image and in the panel, applied instantly
- Font (Pressuru, Oswald, Impact, Sans, Serif, Mono), size, text color, outline color and width, alignment
- Text opacity slider (0-100%), applied to fill and outline and included in exports
- Switching language keeps your current edit (layers, colors, rotation, opacity and image are restored once); a plain refresh starts fresh. JS/CSS asset URLs carry a content hash, so new deploys are never stuck behind a stale browser cache
- Share with complete Open Graph / Twitter cards and a dedicated 1200×630 share image; the Share button uses the Web Share API when available
- Export as PNG or JPG at the image's full resolution
- Mobile-first UI with large touch targets; desktop gets a two-column layout

## Languages

Seven locales, each with its own URL, canonical link and full hreflang set:

- English — `/en/`
- 简体中文 — `/zh/`
- Español — `/es/`
- Português — `/pt/`
- 日本語 — `/ja/`
- Deutsch — `/de/`
- Français — `/fr/`

The root URL redirects to the visitor's browser language.

## Development

No dependencies. Node.js 18+ only.

```sh
npm run build    # generates dist/ (7 locale pages + assets + sitemap)
npm run preview  # serves dist/ at http://localhost:8907/
```

Layout: `src/` (page template, editor `app.js`, `styles.css`, `i18n.mjs`), `assets/` (templates, fonts), `build.mjs` (static generator). Deployment is the `dist/` folder published to the `gh-pages` branch.

## License

MIT, see [LICENSE](LICENSE). Fonts: Pressuru and Oswald (OFL), license files in `assets/fonts/`.

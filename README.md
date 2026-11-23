# IC to PDF Generator

Snap the front and back of a Malaysian IC (MyKad), add a custom diagonal watermark
(e.g. "FOR BANK ACCOUNT OPENING ONLY"), and download an A4 PDF.

**Privacy:** everything runs in the browser. Photos are never uploaded or stored on a server.

## Features

- Snap with the phone camera or upload from the gallery
- Auto-rotate portrait photos, with manual rotate
- Watermark: custom caption and presets, position, colour, size, opacity, optional date,
  and an option to repeat it across the whole card
- The watermark is burned into the image pixels, so it can't be removed as a separate PDF layer
- A4 PDF with the front on top and the back below, in **Enlarged** (130 mm) or **Actual size** (85.6 × 54 mm)
- Download the PDF, or share it straight to WhatsApp or email (Web Share API)

## Development

```bash
npm install
npm run dev
```

To test the camera on a phone, use `npm run dev -- --host` and open the URL on the same Wi-Fi.
Note that browsers only allow camera access over HTTPS, so deploy a Vercel preview for full testing.

## Build

```bash
npm run build
```

## Deploy (Vercel)

Import the GitHub repo in Vercel. It auto-detects Vite and deploys `dist/` as a static
site, with no serverless functions.

## Stack

Vite + React + TypeScript, Canvas API, [pdf-lib](https://pdf-lib.js.org/).

## Roadmap

- [x] Phase 1: capture, watermark, preview, PDF export
- [ ] Phase 2: 4-corner crop with perspective correction
- [ ] Phase 3: PWA (installable, offline)
- [ ] Phase 4: live camera with card guide frame, auto edge detection

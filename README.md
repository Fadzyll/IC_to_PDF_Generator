# IC to PDF Generator

Snap the front and back of a Malaysian IC (MyKad), add a custom diagonal watermark
(e.g. "FOR BANK ACCOUNT OPENING ONLY"), and download an A4 PDF.

**Privacy:** everything runs in the browser. Photos are never uploaded or stored on a server.

## Features

- **Live camera** with a card-shaped guide frame and torch toggle. If live camera isn't
  available, it falls back to the phone's camera app. You can also upload from the gallery
- **Auto-detects the card edges**, then lets you drag the 4 corners (with a magnifier)
- **Perspective correction**: a tilted photo is straightened into a flat card
- Flip 180°, and re-edit the crop at any time
- **Scanner-style filters** (like CamScanner) with live thumbnails: Auto enhance (fixes colour casts,
  contrast and sharpness), Magic colour (removes shadows and uneven lighting), Grayscale, and B&W (photocopy look)
- Watermark: custom caption and presets, position, colour, size, opacity, optional date,
  and an option to repeat it across the whole card
- The watermark is burned into the image pixels, so it can't be removed as a separate PDF layer
- A4 PDF with the front on top and the back below, in **Enlarged** (130 mm) or **Actual size** (85.6 × 54 mm)
- Download the PDF, or share it straight to WhatsApp or email (Web Share API)
- **Installable PWA** that works fully offline after the first visit

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

## How it works

| File | What it does |
|---|---|
| `src/lib/detect.ts` | Card edge detection without OpenCV. It finds colour edges (Sobel), then straight lines (Hough), then scores card-shaped quadrilaterals by edge support, the contrast across each edge, and how consistent the colour is just inside it. If one edge is invisible (e.g. in shadow), it infers that edge from the card's fixed 85.6 × 54 proportions |
| `src/lib/perspective.ts` | Homography and perspective warp to a flat ID-1 card (85.6 × 54 mm) |
| `src/lib/filters.ts` | Enhance filters: auto levels, saturation, unsharp mask, lighting flattening, adaptive threshold |
| `src/lib/watermark.ts` | Draws the diagonal two-line caption banner |
| `src/lib/card.ts` | Rounds the corners, adds padding and burns in the watermark |
| `src/lib/pdf.ts` | A4 layout with pdf-lib (lazy-loaded) |
| `src/components/Camera.tsx` | Live camera with the guide frame |
| `src/components/Cropper.tsx` | Corner editor with magnifier and live preview |

## Tips for best results

- Put the card on a plain surface that contrasts with it (a dark table works best for a MyKad)
- Use good, even light and avoid glare on the card
- If auto-detect misses, drag the corners. The magnifier shows exactly where each corner is

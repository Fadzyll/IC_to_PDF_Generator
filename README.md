# ScanGo PDF

A free phone scanner that runs in the browser, with two tools:

| Page | URL | What it does |
|---|---|---|
| Landing | `/` | Introduces the site and links to both tools |
| IC to PDF | `/ic-to-pdf` | Front and back of a Malaysian IC (MyKad) on one A4 page, with a custom diagonal watermark (e.g. "FOR BANK ACCOUNT OPENING ONLY") |
| Picture to PDF | `/picture-to-pdf` | One or many photos (documents, receipts, notes) combined into a single multi-page PDF |

**Privacy:** everything runs in the browser. Photos are never uploaded or stored on a server.

To rename the site, change "ScanGo PDF" in the three `.html` pages and the PWA manifest in `vite.config.ts`.

## IC to PDF features

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

## Picture to PDF features

- **Add pages** by picking many photos at once, or with a camera mode that keeps snapping page after page
- **Auto-crop documents**: finds page edges (any shape: A4, receipts, landscape) and straightens them; already-clean images are left as they are
- **Page list**: reorder, rotate, delete, and tap a page to adjust its crop
- **Filters** for all pages; for documents, Magic colour also removes colour casts so paper comes out white
- **PDF options**: A4, Letter or fit-to-photo pages, margins, quality (file size), file name, optional watermark
- Up to 50 pages. Pages are stored as compressed JPEGs and the PDF is built one page at a time, so it stays within phone (iPhone Safari) memory limits

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

## SEO

- Each page has its own title, description, canonical link and Open Graph/Twitter preview image (`public/og-*.jpg`)
- JSON-LD structured data: `WebSite`, `WebApplication` (free) and `FAQPage`
- Crawlable header, how-it-works and FAQ in plain HTML (English and Bahasa Melayu) in each `.html` page
- `robots.txt` and `sitemap.xml` (all three pages) generated at build time (`seo.config.ts`)
- Clean URLs on Vercel (`cleanUrls` in `vercel.json`): `/ic-to-pdf` serves `ic-to-pdf.html`

The site URL is taken from Vercel's production domain automatically. To use a custom
domain, set the `SITE_URL` environment variable in Vercel (e.g. `https://ictopdf.my`).
To verify ownership in Google Search Console with the HTML tag method, set
`GOOGLE_SITE_VERIFICATION` to the verification code (or paste the whole meta tag; the code is extracted) and redeploy.

## Stack

Vite + React + TypeScript, Canvas API, [pdf-lib](https://pdf-lib.js.org/).

## How it works

| File | What it does |
|---|---|
| `index.html`, `ic-to-pdf.html`, `picture-to-pdf.html` | The three pages (Vite multi-page build) |
| `src/apps/ic`, `src/apps/picture`, `src/apps/landing` | Entry points and screens for each page |
| `src/lib/pages.ts`, `src/lib/pdf-pages.ts` | Picture to PDF: page processing and the multi-page PDF builder |
| `src/lib/detect.ts` | Card and document edge detection without OpenCV. It finds colour edges (Sobel), then straight lines (Hough), then scores card-shaped quadrilaterals by edge support, the contrast across each edge, and how consistent the colour is just inside it. If one edge is invisible (e.g. in shadow), it infers that edge from the card's fixed 85.6 × 54 proportions |
| `src/lib/perspective.ts` | Homography and perspective warp to a flat ID-1 card (85.6 × 54 mm) |
| `src/lib/filters.ts` | Enhance filters: auto levels, saturation, unsharp mask, lighting flattening, adaptive threshold |
| `src/lib/watermark.ts` | Draws the diagonal two-line caption banner |
| `src/lib/card.ts` | Rounds the corners, adds padding and burns in the watermark |
| `src/lib/pdf.ts` | A4 layout with pdf-lib (lazy-loaded) |
| `src/components/Camera.tsx` | Live camera with the card guide frame, or multi-shot mode for documents |
| `src/components/Cropper.tsx` | Corner editor with magnifier and live preview |

## Tips for best results

- Put the card on a plain surface that contrasts with it (a dark table works best for a MyKad)
- Use good, even light and avoid glare on the card
- If auto-detect misses, drag the corners. The magnifier shows exactly where each corner is

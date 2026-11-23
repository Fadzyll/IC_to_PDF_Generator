import type { Plugin } from 'vite'

/**
 * Public URL of the site, used for canonical links, social previews and the sitemap.
 * Set SITE_URL to override (e.g. a custom domain). On Vercel it defaults to the
 * project's production domain automatically.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const url = explicit || (vercel ? `https://${vercel}` : 'http://localhost:4173')
  return url.replace(/\/+$/, '')
}

/**
 * Google Search Console verification code from GOOGLE_SITE_VERIFICATION.
 * Accepts either the bare code or the whole <meta ... content="..."> tag as
 * Google shows it, and ignores stray spaces or quotes.
 */
export function verificationCode(raw = process.env.GOOGLE_SITE_VERIFICATION): string | null {
  if (!raw) return null
  const fromTag = raw.match(/content\s*=\s*["']?([^"'\s>]+)/i)
  const code = (fromTag ? fromTag[1] : raw).trim().replace(/^["']|["']$/g, '')
  // Google's codes are URL-safe base64: letters, digits, '-' and '_'.
  if (!/^[A-Za-z0-9_-]{10,}$/.test(code)) {
    console.warn(`[seo] GOOGLE_SITE_VERIFICATION doesn't look like a verification code; skipping it.`)
    return null
  }
  return code
}

/**
 * Fills %SITE_URL% (and optional Google Search Console verification) into
 * index.html, and emits robots.txt and sitemap.xml at build time.
 */
export function seo(): Plugin {
  const url = siteUrl()
  const verification = verificationCode()
  return {
    name: 'seo',
    transformIndexHtml(html) {
      html = html.replaceAll('%SITE_URL%', url)
      if (verification) {
        html = html.replace(
          '</head>',
          `  <meta name="google-site-verification" content="${verification}" />\n  </head>`,
        )
      }
      return html
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${url}/sitemap.xml\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${url}/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`,
      })
    },
  }
}

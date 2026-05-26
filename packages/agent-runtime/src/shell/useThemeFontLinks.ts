import { useEffect } from 'react';

/**
 * Ensure the `<link>` elements described by `fontLinks` exist in
 * `document.head`. Idempotent — never inserts a duplicate for a URL
 * that's already present.
 *
 * `fontLinks` is a free-form HTML string containing one or more `<link>`
 * tags (same shape the seed-time `{{FONT_LINKS}}` substitution produces).
 * We extract `href` attributes via regex and synthesize element nodes
 * manually — we never inject the raw HTML, so a malicious manifest
 * cannot smuggle script tags through this path. The link's `rel` is
 * inferred from the URL (`preconnect` for the two Google Fonts root
 * hosts, `stylesheet` for everything else); `crossorigin=anonymous` is
 * applied to the `fonts.gstatic.com` preconnect.
 *
 * Old fonts from prior themes are intentionally NOT removed. The browser
 * dedupes by `href` and the file size of a stylesheet link tag is
 * negligible. Removing them would re-trigger paint flashes on theme
 * round-trips. If a build accumulates too many tags after many switches,
 * a full reload clears them.
 */
const HREF_RE = /<link[^>]*href="([^"]+)"[^>]*>/gi;

function inferRel(url: string): 'preconnect' | 'stylesheet' {
  // The two Google Fonts root hosts are the only `preconnect` candidates in
  // the standard fontLinks shape. Everything else (the css2 request URL) is
  // a `stylesheet`.
  if (url === 'https://fonts.googleapis.com' || url === 'https://fonts.gstatic.com') {
    return 'preconnect';
  }
  return 'stylesheet';
}

export function useThemeFontLinks(fontLinks: string | undefined): void {
  useEffect(() => {
    if (!fontLinks || typeof document === 'undefined') return;
    const urls = new Set<string>();
    for (const match of fontLinks.matchAll(HREF_RE)) urls.add(match[1]);
    if (urls.size === 0) return;

    for (const url of urls) {
      // Skip if a link with this href is already in the head, whether the
      // host's `index.html` shipped it or a prior theme's effect added it.
      const escaped = (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(url) : url.replace(/"/g, '\\"'));
      if (document.querySelector(`link[href="${escaped}"]`)) continue;
      const link = document.createElement('link');
      link.rel = inferRel(url);
      link.href = url;
      if (url === 'https://fonts.gstatic.com') link.crossOrigin = 'anonymous';
      link.setAttribute('data-source', 'agent-runtime:theme-fonts');
      document.head.appendChild(link);
    }
  }, [fontLinks]);
}

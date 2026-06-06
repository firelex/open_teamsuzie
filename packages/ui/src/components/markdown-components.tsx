import { isValidElement, type ReactNode } from "react"
import type { Components } from "react-markdown"

import { MermaidBlock } from "./mermaid-block"

/**
 * Rewrites a relative URL against `baseUrl` so workspace-relative media
 * (`./screenshots/foo.png`, `docs/diagram.svg`) resolves through an
 * upstream proxy endpoint instead of the current page URL. Absolute,
 * protocol-relative, data:, blob:, mailto: and #-anchor URLs are left
 * alone. Returns the input unchanged when `baseUrl` is undefined.
 */
function rewriteRelative(url: string | undefined, baseUrl: string | undefined): string | undefined {
  if (!url || !baseUrl) return url
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:|data:|blob:)/i.test(url)) return url
  const stripped = url.replace(/^\.?\//, "")
  return baseUrl.replace(/\/+$/, "") + "/" + stripped
}

export interface MakeMarkdownComponentsOptions {
  /**
   * Prefix used to resolve relative media URLs. Typically a project's
   * preview endpoint (`/api/projects/<id>/preview/`). When omitted, URLs
   * pass through untouched.
   */
  imageBaseUrl?: string
}

/**
 * Shared `react-markdown` components map. Detects `language-mermaid`
 * fenced blocks and swaps them for a rendered diagram; everything else
 * falls through to react-markdown's defaults (which the surrounding
 * `prose` classes then style).
 *
 * When `imageBaseUrl` is provided, `<img>` / `<video>` / `<source>` href
 * targets that look relative are rewritten to load from that base.
 */
export function makeMarkdownComponents(opts: MakeMarkdownComponentsOptions = {}): Components {
  const { imageBaseUrl } = opts
  return {
    pre({ children, ...rest }) {
      const child = Array.isArray(children) ? children[0] : children
      if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
        const className = child.props.className ?? ""
        const m = /language-(\w+)/.exec(className)
        if (m && m[1] === "mermaid") {
          const code = String(child.props.children ?? "").replace(/\n$/, "")
          return <MermaidBlock code={code} />
        }
      }
      return <pre {...rest}>{children}</pre>
    },
    img({ src, alt, ...rest }) {
      const resolved = rewriteRelative(typeof src === "string" ? src : undefined, imageBaseUrl)
      return <img {...rest} src={resolved} alt={alt ?? ""} loading="lazy" />
    },
    video({ src, children, ...rest }) {
      const resolved = rewriteRelative(typeof src === "string" ? src : undefined, imageBaseUrl)
      return (
        <video {...rest} src={resolved} controls>
          {children}
        </video>
      )
    },
    source({ src, srcSet, ...rest }) {
      const resolvedSrc = rewriteRelative(typeof src === "string" ? src : undefined, imageBaseUrl)
      const resolvedSrcSet =
        typeof srcSet === "string"
          ? srcSet
              .split(",")
              .map((part) => {
                const trimmed = part.trim()
                const [u, ...rest2] = trimmed.split(/\s+/)
                const r = rewriteRelative(u, imageBaseUrl) ?? u
                return [r, ...rest2].join(" ")
              })
              .join(", ")
          : srcSet
      return <source {...rest} src={resolvedSrc} srcSet={resolvedSrcSet} />
    },
  }
}

/** Default components without any URL rewriting — for non-project surfaces. */
export const markdownComponents: Components = makeMarkdownComponents()

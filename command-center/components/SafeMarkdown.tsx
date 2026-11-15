import { createElement, type ReactNode } from "react";
import type { ElementContent } from "hast";
import { renderSafe } from "@/lib/sanitize";

/**
 * The only way bot- or owner-supplied text is rendered as markup (BR-18). It renders the
 * output of renderSafe() (lib/sanitize.ts), the one shared render function: raw HTML is
 * dropped, output is sanitized, images are never rendered (BR-17: no external fetches)
 * and links get rel="noopener nofollow". It builds React elements, never raw HTML strings.
 *
 * - default: block markdown (headings, lists, code, paragraphs)
 * - inline: single-line fields (card values); block structure unwrapped to text
 * - links={false}: for text that is already inside a link (no nested anchors)
 */
export function SafeMarkdown({ children, inline = false, links = true }: { children: string | null | undefined; inline?: boolean; links?: boolean }) {
  const tree = renderSafe(children, { mode: inline ? "inline" : "block", links });
  const body = toReact(tree.children as ElementContent[]);
  return inline ? <span className="safe-md-inline">{body}</span> : <div className="safe-md">{body}</div>;
}

/** hast -> React for the sanitized tree. Only the attributes the sanitizer keeps are copied. */
function toReact(nodes: ElementContent[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.type === "text") return n.value;
    if (n.type !== "element") return null;
    const p = n.properties ?? {};
    const props: Record<string, unknown> = { key: i };
    if (n.tagName === "a" && typeof p.href === "string") {
      props.href = p.href;
      props.rel = Array.isArray(p.rel) ? p.rel.join(" ") : "noopener nofollow";
    }
    if (n.tagName === "ol" && typeof p.start === "number") props.start = p.start;
    return createElement(n.tagName, props, ...(n.tagName === "br" ? [] : toReact(n.children)));
  });
}

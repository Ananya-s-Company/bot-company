// BR-18: the ONE sanitizer for all bot- and owner-supplied text. Text is stored raw and
// sanitized only on output, by renderSafe() below. Every rendering path
// (components/SafeMarkdown for block and inline markdown, toPlainText for attributes,
// titles and other plain contexts) is a thin adapter over renderSafe(), which runs:
//
//   markdown --remark-parse--> mdast --remark-rehype (raw HTML dropped)--> hast
//            --rehype-sanitize(SANITIZE_SCHEMA)--> --linkPolicy--> output
//
// Allowed: headings, paragraphs, bold, italic, lists, inline code and code blocks, and
// links to absolute http/https URLs (rendered with rel="noopener nofollow").
// Denied: images, raw HTML of any kind, every other URL scheme (javascript:, data:,
// mailto:, relative links), tables, iframes, attributes such as style/class/on*.
import type { ElementContent, Root, RootContent } from "hast";
import rehypeSanitize, { type Options as SanitizeSchema } from "rehype-sanitize";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type PluggableList } from "unified";

export const ALLOWED_BLOCK_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "strong", "em", "ul", "ol", "li", "code", "pre", "a"] as const;
/** Inline contexts (card fields): block structure is unwrapped to its text. */
export const ALLOWED_INLINE_TAGS = ["strong", "em", "code", "a", "br"] as const;

export const SANITIZE_SCHEMA: SanitizeSchema = {
  tagNames: [...ALLOWED_BLOCK_TAGS],
  attributes: { a: ["href"], ol: ["start"] },
  protocols: { href: ["http", "https"] },
  ancestors: { li: ["ol", "ul"] },
  required: {},
  strip: ["script", "style", "iframe", "object", "embed", "template"],
  clobber: [],
  clobberPrefix: "user-content-",
};

const SAFE_URL = /^https?:\/\/[^\s/?#]+/i;
export const isAllowedHref = (href: unknown): href is string => typeof href === "string" && SAFE_URL.test(href);

/**
 * Runs after sanitize: links must be absolute http(s) (relative or scheme-less URLs pass
 * hast-util-sanitize, so they are unwrapped here) and always carry rel="noopener nofollow".
 */
export function rehypeLinkPolicy() {
  const fix = (nodes: (RootContent | ElementContent)[]): ElementContent[] => {
    const out: ElementContent[] = [];
    for (const n of nodes) {
      if (n.type === "element") {
        n.children = fix(n.children);
        if (n.tagName === "a") {
          if (!isAllowedHref(n.properties?.href)) {
            out.push(...n.children);
            continue;
          }
          n.properties = { href: n.properties.href, rel: ["noopener", "nofollow"] };
        }
        out.push(n);
      } else if (n.type === "text") {
        out.push(n);
      }
      // comments, doctypes and raw nodes are dropped
    }
    return out;
  };
  return (tree: Root) => {
    tree.children = fix(tree.children);
  };
}

const SAFE_REHYPE_PLUGINS: PluggableList = [[rehypeSanitize, SANITIZE_SCHEMA], rehypeLinkPolicy];

// remark-rehype without allowDangerousHtml drops every raw HTML node before sanitizing.
const processor = unified().use(remarkParse).use(remarkRehype).use(SAFE_REHYPE_PLUGINS);

const BLOCK = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "br", "ul", "ol"]);

export type RenderMode = "block" | "inline" | "plain";
export interface RenderOptions {
  /** block: full markdown. inline: single-line fields. plain: text only (attributes, labels). */
  mode?: RenderMode;
  /** false for text that is already inside a link (no nested anchors). */
  links?: boolean;
}

/**
 * Keeps allowed elements, unwraps the rest to their children (a space after block ones).
 * `flat`: single-line output, so the newline-only separators between blocks are dropped.
 */
function restrict(nodes: ElementContent[], allowed: ReadonlySet<string>, flat: boolean): ElementContent[] {
  const out: ElementContent[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      if (!(flat && /^\s*\n\s*$/.test(n.value))) out.push(n);
    } else if (n.type === "element") {
      const kids = restrict(n.children, allowed, flat);
      if (allowed.has(n.tagName)) out.push({ ...n, children: kids });
      else {
        out.push(...kids);
        if (BLOCK.has(n.tagName)) out.push({ type: "text", value: " " });
      }
    }
  }
  return out;
}

/**
 * BR-18 / ArchitectBot (f): THE render function for every piece of bot- or owner-supplied
 * text. Data is stored raw (exactly as posted); it is sanitized only here, on output.
 * Returns a sanitized hast tree containing only the tags allowed for `mode`.
 * components/SafeMarkdown turns it into React elements; toPlainText reads its text.
 */
export function renderSafe(md: string | null | undefined, opts: RenderOptions = {}): Root {
  const mode = opts.mode ?? "block";
  if (md == null || md === "") return { type: "root", children: [] };
  const tree = processor.runSync(processor.parse(String(md))) as Root;
  const tags: string[] = mode === "plain" ? [] : [...(mode === "inline" ? ALLOWED_INLINE_TAGS : ALLOWED_BLOCK_TAGS)];
  const allowed = new Set(tags.filter((t) => opts.links !== false || t !== "a"));
  let children = restrict(tree.children as ElementContent[], allowed, mode !== "block");
  if (mode === "plain") {
    const text = children.map((n) => (n.type === "text" ? n.value : "")).join("").replace(/\s+/g, " ").trim();
    children = text ? [{ type: "text", value: text }] : [];
  } else if (mode === "inline") {
    // Single-line context: trim the whitespace left over from unwrapped blocks.
    children = trimEdges(children);
  }
  return { type: "root", children: children as RootContent[] };
}

function trimEdges(nodes: ElementContent[]): ElementContent[] {
  const out = [...nodes];
  while (out[0]?.type === "text" && out[0].value.trim() === "") out.shift();
  while (out.at(-1)?.type === "text" && (out.at(-1) as { value: string }).value.trim() === "") out.pop();
  return out;
}

/**
 * Plain text through the same render function: markdown syntax and HTML are removed,
 * whitespace collapsed. For attribute values (title/tooltips), option labels and short labels.
 */
export function toPlainText(md: string | null | undefined): string {
  const [first] = renderSafe(md, { mode: "plain" }).children;
  return first?.type === "text" ? first.value : "";
}

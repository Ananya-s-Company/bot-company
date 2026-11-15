import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdeaCard } from "../components/IdeaCard";
import { SafeMarkdown } from "../components/SafeMarkdown";
import { renderSafe, toPlainText } from "../lib/sanitize";
import { makeData } from "./helpers";

// BR-18 + ArchitectBot (f): store raw text, sanitize on output via ONE shared render function.

const ROOT = path.join(__dirname, "..");
/** Real tags and attributes only (an idea's URL slug may legitimately contain the word "onerror"). */
const UNSAFE = /<script|<img|<iframe|\son\w+=|href="\s*(javascript|data|vbscript):/i;
const EVIL =`**bold** <script>alert(1)</script><img src=x onerror=alert(1)> [x](javascript:alert(1)) <a href="https://e.example" onclick="x()">raw</a> ![p](https://e.example/p.png)`;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("raw storage (sanitize on output only)", () => {
  it("ideas and updates are stored and read back exactly as posted", () => {
    const { data } = makeData();
    const idea = data.ideas.create({ name: EVIL, owning_lead_bot: "<b>PMBot</b>", next_step: EVIL });
    expect(data.ideas.get(idea.id)).toMatchObject({ name: EVIL, owning_lead_bot: "<b>PMBot</b>", next_step: EVIL });
    const { update } = data.updates.create({ bot: "PMBot", team: "PM", text: EVIL });
    expect(data.updates.list().find((u) => u.id === update.id)?.text).toBe(EVIL);
  });

  it("the data layer never sanitizes or escapes on input", () => {
    for (const f of sourceFiles(path.join(ROOT, "lib/data"))) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/from\s+["'][^"']*(sanitize|rehype|remark|dompurify)/i);
    }
  });

  it("raw stored content renders safely on a real component", () => {
    const { data } = makeData();
    const idea = data.ideas.create({ name: EVIL, owning_lead_bot: `"><script>x</script>`, next_step: EVIL });
    const html = renderToStaticMarkup(<IdeaCard idea={data.ideas.get(idea.id)!} meta={{}} />);
    expect(html).not.toMatch(UNSAFE);
    expect(html).toContain("<strong>bold</strong>");
  });
});

describe("one shared render function", () => {
  it("renderSafe is the only sanitizer: no other markdown/HTML renderer or raw HTML injection in the app", () => {
    const files = [...sourceFiles(path.join(ROOT, "app")), ...sourceFiles(path.join(ROOT, "components")), ...sourceFiles(path.join(ROOT, "lib"))];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      const rel = path.relative(ROOT, f);
      expect(src, rel).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=/);
      expect(src, rel).not.toMatch(/from\s+["']react-markdown["']/);
      if (rel !== path.join("lib", "sanitize.ts")) expect(src, rel).not.toMatch(/from\s+["'](rehype-|remark-|unified)/);
    }
    // Both adapters are built on renderSafe.
    expect(fs.readFileSync(path.join(ROOT, "components/SafeMarkdown.tsx"), "utf8")).toMatch(/renderSafe\(/);
    expect(fs.readFileSync(path.join(ROOT, "lib/sanitize.ts"), "utf8")).toMatch(/export function toPlainText[\s\S]*?renderSafe\(/);
  });

  it("block mode keeps safe markdown and drops scripts, images, event handlers and bad URLs", () => {
    const html = renderToStaticMarkup(<SafeMarkdown>{`# Title\n\n- one\n- two\n\n\`code\` [ok](https://ok.example/a) ${EVIL}`}</SafeMarkdown>);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://ok.example/a" rel="noopener nofollow">ok</a>');
    expect(html).not.toMatch(UNSAFE);
  });

  it("inline mode unwraps block structure; links={false} removes anchors", () => {
    expect(renderToStaticMarkup(<SafeMarkdown inline>{"# Big\n\nnext **x**"}</SafeMarkdown>)).toBe('<span class="safe-md-inline">Big next <strong>x</strong></span>');
    expect(renderToStaticMarkup(<SafeMarkdown inline links={false}>{"[a](https://x.example)"}</SafeMarkdown>)).toBe('<span class="safe-md-inline">a</span>');
  });

  it("plain mode (toPlainText) is the same pipeline, reduced to text", () => {
    const plain = toPlainText(EVIL);
    expect(plain).toMatch(/^bold\b/);
    // Markup is gone; what was between <script> tags survives only as inert, escaped text.
    expect(plain).not.toMatch(/[<>*]|javascript|onerror|https?:/);
    expect(toPlainText("<b>PMBot</b>")).toBe("PMBot");
    expect(toPlainText(null)).toBe("");
    expect(renderSafe("plain *text*", { mode: "plain" }).children).toEqual([{ type: "text", value: "plain text" }]);
  });

  it("relative, protocol-relative, data: and mailto: links are not rendered as links", () => {
    for (const href of ["/admin", "//evil.example", "data:text/html,x", "mailto:a@b.example", "vbscript:x"]) {
      const html = renderToStaticMarkup(<SafeMarkdown>{`[t](${href})`}</SafeMarkdown>);
      expect(html, href).not.toContain("<a");
    }
  });
});

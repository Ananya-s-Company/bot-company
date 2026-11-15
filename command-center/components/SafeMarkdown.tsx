import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/**
 * The only way bot-provided markdown is rendered (BR-18). Raw HTML is dropped (no rehype-raw),
 * output is sanitized, and images are disallowed so rendering never fetches external resources (BR-17).
 */
export function SafeMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown skipHtml rehypePlugins={[rehypeSanitize]} disallowedElements={["img"]} unwrapDisallowed>
      {children}
    </ReactMarkdown>
  );
}

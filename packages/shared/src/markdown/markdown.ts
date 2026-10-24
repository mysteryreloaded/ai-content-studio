import MarkdownIt from "markdown-it";

/**
 * The one shared Markdown renderer (CommonMark; no raw HTML, which
 * markdown-it escapes instead of passing through; no images, dropped by
 * disabling the `image` rule). Every link gets `target="_blank"` and
 * `rel="noopener noreferrer nofollow"` so pasted terms text can never
 * keep a visitor's referrer or tab. Used for both the Site terms admin
 * preview and the `/terms` page, so both render identically.
 */
const markdownIt = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

// Disabling the `image` parser rule leaves `![alt](url)` to fall through
// to the link rule (rendered as a plain link), so the renderer rule is
// overridden instead: the token still parses, but renders as nothing.
markdownIt.renderer.rules.image = () => "";

const defaultLinkOpenRenderer =
  markdownIt.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options));

markdownIt.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer nofollow");
  }
  return defaultLinkOpenRenderer(tokens, idx, options, env, self);
};

/** Renders `markdown` to sanitized HTML safe to insert with `dangerouslySetInnerHTML`. */
export function renderMarkdown(markdown: string): string {
  return markdownIt.render(markdown);
}

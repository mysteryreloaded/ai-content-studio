---
status: accepted
---

# One shared Markdown renderer for Operator-written legal text

Site terms, Model terms and the Operator's part of the Privacy policy are all Markdown an Admin pastes or writes into a textarea, then shown to people who never chose to trust that HTML. We decided they share one rendering module, called both by the admin editor's live preview and by every page that shows the rendered result (the terms gate, `/terms`, `/privacy`, the Model terms dialog): CommonMark only, raw HTML disabled, image tokens dropped, and every link forced to `target="_blank" rel="noopener noreferrer nofollow"`.

The deciding reason is that an image in this text would let it load an external pixel and leak a visitor's IP address before they've agreed to anything, and raw HTML is an XSS vector into pages served to signed-out visitors; closing both at parse time means there is nothing left to sanitize, and nothing to get wrong twice between the editor's preview and the three consuming pages.

## Considered Options

- **Full CommonMark plus a sanitizer (e.g. DOMPurify) to allow images and inline HTML.** Keeps more of what a lawyer might paste, but it reopens the pixel-leak and widens the attack surface the sanitizer has to get exactly right, twice: once for the preview, once for the served pages.
- **A WYSIWYG rich-text editor storing HTML.** No clean path to "no HTML, no images" without re-sanitizing on every save, and plain Markdown is friendlier to paste from a legal document than a rich-text widget is to paste into.

## Consequences

- One renderer module is the only thing allowed to turn Site terms, Model terms or the Privacy policy's Operator text into HTML; nothing else in the app parses Markdown.
- The editor's live preview calls the same module the served pages do, so what an Admin previews is exactly what ships.
- Attribution and landing text stay plain text, not Markdown: they're short, shown inline, and never meant to carry links or formatting.

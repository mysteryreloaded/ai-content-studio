import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  test("renders CommonMark formatting", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and _italic_ text.");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  test("escapes raw HTML instead of passing it through", () => {
    const html = renderMarkdown('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("drops images entirely", () => {
    const html = renderMarkdown("![alt text](https://example.com/x.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("example.com/x.png");
  });

  test("opens links in a new tab without leaking a referrer or granting trust", () => {
    const html = renderMarkdown("[a link](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('href="https://example.com"');
  });

  test("refuses a javascript: link scheme", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript:');
  });
});

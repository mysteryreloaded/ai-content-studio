import { renderMarkdown } from "@ai-content-studio/shared";
import { cn } from "cn";
import { Label } from "../ui/label.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Textarea } from "../ui/textarea.js";

/**
 * The shared Markdown editor (issue #202, also used by the Model editor's
 * Model terms, #217): a labelled mono textarea with a counter against
 * `maxLength`, beside a live `prose` preview of `renderMarkdown(value)`.
 * Two columns at `lg` and up; `Write`/`Preview` tabs below it, over the
 * same always-mounted controls so neither layout duplicates the field.
 */
export function MarkdownEditor({
  id,
  label,
  hint = "Markdown: headings, lists, links and emphasis. No images or HTML.",
  value,
  onChange,
  maxLength,
  error,
  rows = 16,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  error?: string;
  rows?: number;
}) {
  const overLimit = value.length > maxLength;

  return (
    <Tabs defaultValue="write" className="contents">
      <TabsList className="lg:hidden">
        <TabsTrigger value="write">Write</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <div className="grid gap-4 lg:grid-cols-2">
        <TabsContent
          value="write"
          forceMount
          className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={id}>{label}</Label>
            <Textarea
              id={id}
              rows={rows}
              value={value}
              aria-invalid={error ? true : undefined}
              className="min-h-96 font-mono text-[12.5px]"
              onChange={(event) => onChange(event.target.value)}
            />
            <div className="flex items-baseline justify-between gap-2">
              {error ? (
                <p className="text-err">{error}</p>
              ) : (
                <p className="text-muted-foreground">{hint}</p>
              )}
              <span
                className={cn(
                  "ml-auto shrink-0 text-muted-foreground",
                  overLimit && "text-err",
                )}
              >
                {value.length.toLocaleString()} / {maxLength.toLocaleString()}
              </span>
            </div>
          </div>
        </TabsContent>
        <TabsContent
          value="preview"
          forceMount
          className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Preview
            </p>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-background p-4">
              {value.trim() === "" ? (
                <p className="text-muted-foreground">Nothing to preview yet.</p>
              ) : (
                <div
                  className="prose max-w-none prose-a:text-primary dark:prose-invert"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
                />
              )}
            </div>
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );
}

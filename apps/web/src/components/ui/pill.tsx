import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/**
 * A small status pill (the prototype's `.pill`) used for Generation states.
 * Tones: `neutral` (default), `accent`, `ok`, `err` and `warn`.
 */
const pillVariants = cva(
  "inline-flex h-fit min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-[1.6]",
  {
    variants: {
      tone: {
        // The prototype's `.pill`: the `--color-muted` token (var(--sunk)) is
        // the fill and `--color-muted-foreground` (var(--muted)) the text, so
        // the default tone has a visible fill and readable text in both modes.
        neutral: "bg-muted text-muted-foreground",
        // The accent tone is tinted with the Admin's brand accent, so it uses
        // `--accent-soft` for the fill and the primary (accent) colour for the
        // text rather than the neutral hover `--accent`.
        accent: "bg-accent-soft text-primary",
        ok: "bg-ok-soft text-ok",
        err: "bg-err-soft text-err",
        warn: "bg-warn-soft text-warn",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
)

function Pill({
  className,
  tone = "neutral",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof pillVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="pill"
      data-tone={tone}
      className={cn(pillVariants({ tone }), className)}
      {...props}
    />
  )
}

export { Pill, pillVariants }

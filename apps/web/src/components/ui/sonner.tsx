"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"
import { useTheme } from "@/useTheme"

const Toaster = ({ ...props }: ToasterProps) => {
  // The app's own System/Light/Dark switch (issue #65/#31) drives the
  // toaster so it matches the rest of the UI; no next-themes dependency.
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // The toaster's CSS hooks resolve against the prototype's raw tokens
      // (the shadcn `--popover`/`--border` names only exist as `--color-*`
      // theme entries, not as custom properties).
      style={
        {
          "--normal-bg": "var(--panel)",
          "--normal-text": "var(--fg)",
          "--normal-border": "var(--line)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

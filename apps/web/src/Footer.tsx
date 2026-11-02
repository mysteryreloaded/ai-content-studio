import { ThemeSwitch } from "./ThemeSwitch.js";
import { useSiteSettings } from "./useSiteSettings.js";

function contactHref(contact: string): string {
  return contact.startsWith("http://") || contact.startsWith("https://")
    ? contact
    : `mailto:${contact}`;
}

// The prototype's `.app-foot` link treatment: muted until hovered.
const linkClass = "hover:text-foreground hover:underline";

/**
 * Every page's footer (issue #65, restyled #173 from the Workbench
 * prototype's `.app-foot`): 12.5px muted text above a top border, with
 * 18px/16px padding and a 6px gap — the links, the theme switch and the
 * repo credit, which is pushed to the right edge.
 */
export function Footer() {
  const settings = useSiteSettings();

  return (
    <footer className="mt-6 flex w-full flex-wrap items-center gap-1.5 border-t border-border px-4 py-[18px] text-[12.5px] text-muted-foreground">
      <nav aria-label="Legal" className="flex flex-wrap items-center gap-1.5">
        <a href="/privacy" className={linkClass}>
          Privacy
        </a>
        {settings?.hasTerms && (
          <a href="/terms" className={linkClass}>
            Terms
          </a>
        )}
        {settings?.contact && (
          <a href={contactHref(settings.contact)} className={linkClass}>
            Contact · Report abuse
          </a>
        )}
        {settings?.footerLinks?.map((link, index) => (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length, admin-set list refetched whole each time; the URL isn't unique enough to key by (issue #65 QA round 3)
            key={index}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <ThemeSwitch />
      <a
        className="ml-auto hover:text-foreground hover:underline"
        href="https://github.com/mysteryreloaded/ai-content-studio"
        target="_blank"
        rel="noopener noreferrer"
      >
        Powered by AI Content Studio
      </a>
    </footer>
  );
}

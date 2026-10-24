import { ThemeSwitch } from "./ThemeSwitch.js";
import { useSiteSettings } from "./useSiteSettings.js";

function contactHref(contact: string): string {
  return contact.startsWith("http://") || contact.startsWith("https://")
    ? contact
    : `mailto:${contact}`;
}

/** Every page's footer (issue #65): Privacy, Terms, Contact, extra links, the theme switch and the repo credit. */
export function Footer() {
  const settings = useSiteSettings();

  return (
    <footer>
      <nav aria-label="Legal">
        <a href="/privacy">Privacy</a>
        {settings?.hasTerms && <a href="/terms">Terms</a>}
        {settings?.contact && (
          <a href={contactHref(settings.contact)}>Contact · Report abuse</a>
        )}
        {settings?.footerLinks.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        ))}
      </nav>
      <ThemeSwitch />
      <a
        href="https://github.com/mysteryreloaded/ai-content-studio"
        target="_blank"
        rel="noopener noreferrer"
      >
        Powered by AI Content Studio
      </a>
    </footer>
  );
}

import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { AdminPage } from "../components/admin/AdminPage.js";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { HistoryLink } from "../components/admin/HistoryLink.js";
import { api, ok } from "../lib/api.js";
import { BlockedWordsForm } from "./BlockedWordsForm.js";
import { CapsForm } from "./CapsForm.js";
import { PauseNoticeForm } from "./PauseNoticeForm.js";
import { SitePrivacyForm } from "./SitePrivacyForm.js";
import { SiteSettingsForm } from "./SiteSettingsForm.js";
import { SiteTermsForm } from "./SiteTermsForm.js";
import {
  type AdminSiteSettings,
  siteSettingsQueryKey,
} from "./site-settings-shared.js";

const SECTIONS = [
  { id: "branding", label: "Branding" },
  { id: "accent", label: "Accent colour" },
  { id: "signup-caps", label: "Sign-up and Caps" },
  { id: "contact-footer", label: "Contact and footer" },
  { id: "blocked-words", label: "Blocked words" },
  { id: "site-terms", label: "Site terms" },
  { id: "privacy-policy", label: "Privacy policy" },
  { id: "notice-pause", label: "Notice and Pause" },
] as const;

/** The sticky-at-desktop, sideways-scrolling-below section nav (issue #201's "Section nav"). */
function SectionNav() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-96px 0px -70% 0px" },
    );
    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Site settings sections"
      className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] lg:sticky lg:top-16 lg:w-[200px] lg:shrink-0 lg:flex-col lg:self-start lg:overflow-visible lg:pb-0"
    >
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          aria-current={activeId === section.id ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-[7px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:text-foreground",
          )}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * The Site settings page frame (issue #201): one header with History, an
 * in-page section nav, and one load of the settings, passed to every
 * form as a prop so none of them fetch on their own.
 */
export function SiteSettingsPage() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: siteSettingsQueryKey,
    queryFn: () => ok<AdminSiteSettings>(api.api.admin["site-settings"].$get()),
  });

  async function reload(): Promise<AdminSiteSettings | undefined> {
    const result = await refetch();
    return result.data;
  }

  return (
    <AdminPage>
      <AdminPageHeader
        title="Site settings"
        description="How the studio looks and who can join. Each section saves on its own."
        actions={
          <HistoryLink targetType="site_settings" targetId="singleton" />
        }
      />

      {isPending && <p className="text-muted-foreground">Loading…</p>}
      {isError && <p className="text-err">Could not load the Site settings.</p>}

      {data && (
        <div className="flex flex-col gap-sections lg:flex-row lg:items-start lg:gap-6">
          <SectionNav />
          <div className="flex min-w-0 flex-1 flex-col gap-sections">
            <SiteSettingsForm
              settings={data}
              onReload={reload}
              capsSlot={<CapsForm settings={data} onReload={reload} />}
            />
            <BlockedWordsForm settings={data} onReload={reload} />
            <SiteTermsForm settings={data} onReload={reload} />
            <SitePrivacyForm settings={data} onReload={reload} />
            <PauseNoticeForm settings={data} />
          </div>
        </div>
      )}
    </AdminPage>
  );
}

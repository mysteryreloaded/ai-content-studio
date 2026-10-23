import { useEffect, useState } from "react";

interface SiteSettings {
  title: string;
}

export function LandingPage() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    fetch("/api/site-settings")
      .then((res) => res.json())
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  return (
    <main>
      <h1>{settings?.title ?? "AI Content Studio"}</h1>
    </main>
  );
}

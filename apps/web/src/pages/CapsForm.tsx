import { SITE_CAP_MAX, SITE_CAP_MIN } from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useState } from "react";

interface AdminCaps {
  dailyCap: number;
  concurrentCap: number;
  capsRevision: number;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "saved" };

/** The daily/concurrent generation Caps form (issue #53), shown in the Admin panel next to Blocked words. */
export function CapsForm() {
  const [settings, setSettings] = useState<AdminCaps | null>(null);
  const [dailyCap, setDailyCap] = useState("");
  const [concurrentCap, setConcurrentCap] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  useEffect(() => {
    fetch("/api/admin/site-settings")
      .then((res) => res.json() as Promise<AdminCaps>)
      .then((data) => {
        setSettings(data);
        setDailyCap(String(data.dailyCap));
        setConcurrentCap(String(data.concurrentCap));
      })
      .catch(() => {});
  }, []);

  if (!settings) return <p>Loading…</p>;

  const dailyCapNumber = Number(dailyCap);
  const concurrentCapNumber = Number(concurrentCap);
  const listError =
    !Number.isInteger(dailyCapNumber) ||
    dailyCapNumber < SITE_CAP_MIN ||
    dailyCapNumber > SITE_CAP_MAX ||
    !Number.isInteger(concurrentCapNumber) ||
    concurrentCapNumber < SITE_CAP_MIN ||
    concurrentCapNumber > SITE_CAP_MAX
      ? `Both caps must be whole numbers between ${SITE_CAP_MIN} and ${SITE_CAP_MAX}.`
      : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (listError || !settings) return;

    setSaveState({ status: "saving" });
    const res = await fetch("/api/admin/site-settings/caps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: settings.capsRevision,
        dailyCap: dailyCapNumber,
        concurrentCap: concurrentCapNumber,
      }),
    });

    if (res.status === 409) {
      setSaveState({
        status: "error",
        message: "changed by someone else, reload",
      });
      return;
    }
    if (!res.ok) {
      setSaveState({ status: "error", message: "save failed" });
      return;
    }

    const updated = (await res.json()) as AdminCaps;
    setSettings(updated);
    setDailyCap(String(updated.dailyCap));
    setConcurrentCap(String(updated.concurrentCap));
    setSaveState({ status: "saved" });
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <h2>Generation caps</h2>
      <p>
        Site-wide defaults for how many Generations a user can run per day
        (rolling 24h, excluding failures) and at once. Whole numbers between{" "}
        {SITE_CAP_MIN} and {SITE_CAP_MAX.toLocaleString()}.
      </p>

      <label htmlFor="caps-daily">Daily cap</label>
      <input
        id="caps-daily"
        type="number"
        min={SITE_CAP_MIN}
        max={SITE_CAP_MAX}
        value={dailyCap}
        onChange={(event) => setDailyCap(event.target.value)}
      />

      <label htmlFor="caps-concurrent">Concurrent cap</label>
      <input
        id="caps-concurrent"
        type="number"
        min={SITE_CAP_MIN}
        max={SITE_CAP_MAX}
        value={concurrentCap}
        onChange={(event) => setConcurrentCap(event.target.value)}
      />
      {listError && <p role="alert">{listError}</p>}

      <button
        type="submit"
        disabled={!!listError || saveState.status === "saving"}
      >
        Save
      </button>
      {saveState.status === "error" && <p role="alert">{saveState.message}</p>}
      {saveState.status === "saved" && <p>Saved.</p>}
    </form>
  );
}

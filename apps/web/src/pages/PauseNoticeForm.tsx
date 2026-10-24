import { NOTICE_MAX_LENGTH } from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface AdminPauseNotice {
  notice: string;
  noticeRevision: number;
  paused: boolean;
  pausedAt: string | null;
  pausedByName: string | null;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "saved" };

/** The Notice and Pause/Resume controls (issue #59), shown in the Admin panel's Site settings. */
export function PauseNoticeForm() {
  const [settings, setSettings] = useState<AdminPauseNotice | null>(null);
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [pauseState, setPauseState] = useState<SaveState>({ status: "idle" });

  function load() {
    fetch("/api/admin/site-settings")
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        return res.json() as Promise<AdminPauseNotice>;
      })
      .then((data) => {
        setSettings(data);
        setText(data.notice);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  if (!settings) return <p>Loading…</p>;

  const textError =
    text.length > NOTICE_MAX_LENGTH
      ? `Notice must be ${NOTICE_MAX_LENGTH} characters or fewer`
      : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (textError || !settings) return;

    setSaveState({ status: "saving" });
    const res = await fetch("/api/admin/site-settings/notice", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: settings.noticeRevision, text }),
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

    const updated = (await res.json()) as AdminPauseNotice;
    setSettings(updated);
    setText(updated.notice);
    setSaveState({ status: "saved" });
  }

  async function handlePauseToggle() {
    setPauseState({ status: "saving" });
    const res = await fetch(
      `/api/admin/site-settings/${settings?.paused ? "resume" : "pause"}`,
      { method: "POST" },
    );

    if (!res.ok) {
      setPauseState({ status: "error", message: "failed, reload" });
      return;
    }

    const updated = (await res.json()) as AdminPauseNotice;
    setSettings(updated);
    setPauseState({ status: "idle" });
  }

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <h2>Notice</h2>
        <Link to="/admin/audit?targetType=site_settings&targetId=singleton">
          History
        </Link>

        <label htmlFor="site-notice">
          Shown as a banner on every page, signed in or out
        </label>
        <textarea
          id="site-notice"
          value={text}
          maxLength={NOTICE_MAX_LENGTH}
          onChange={(event) => setText(event.target.value)}
        />
        {textError && <p role="alert">{textError}</p>}

        <button
          type="submit"
          disabled={!!textError || saveState.status === "saving"}
        >
          Save
        </button>
        {saveState.status === "error" && (
          <p role="alert">{saveState.message}</p>
        )}
        {saveState.status === "saved" && <p>Saved.</p>}
      </form>

      <section>
        <h2>Pause</h2>
        <p>
          {settings.paused
            ? `Paused since ${new Date(settings.pausedAt ?? "").toLocaleString()} by ${settings.pausedByName}`
            : "Generating is running normally."}
        </p>
        <button
          type="button"
          onClick={() => void handlePauseToggle()}
          disabled={pauseState.status === "saving"}
        >
          {settings.paused ? "Resume" : "Pause"}
        </button>
        {pauseState.status === "error" && (
          <p role="alert">{pauseState.message}</p>
        )}
      </section>
    </>
  );
}

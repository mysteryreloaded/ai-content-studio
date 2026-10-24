import {
  BLOCKED_WORDS_MAX_ENTRIES,
  BLOCKED_WORDS_MAX_ENTRY_LENGTH,
  parseBlockedWordsList,
  validateBlockedWordsList,
} from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useState } from "react";

interface AdminBlockedWords {
  blockedWords: string[];
  blockedWordsRevision: number;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "saved" };

/** The blocked words/phrases form (issue #66), shown in the Admin panel next to Site terms and Privacy. */
export function BlockedWordsForm() {
  const [settings, setSettings] = useState<AdminBlockedWords | null>(null);
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  useEffect(() => {
    fetch("/api/admin/site-settings")
      .then((res) => res.json() as Promise<AdminBlockedWords>)
      .then((data) => {
        setSettings(data);
        setText(data.blockedWords.join("\n"));
      })
      .catch(() => {});
  }, []);

  if (!settings) return <p>Loading…</p>;

  const words = parseBlockedWordsList(text);
  const listError = validateBlockedWordsList(words);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (listError || !settings) return;

    setSaveState({ status: "saving" });
    const res = await fetch("/api/admin/site-settings/blocked-words", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: settings.blockedWordsRevision, text }),
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

    const updated = (await res.json()) as AdminBlockedWords;
    setSettings(updated);
    setText(updated.blockedWords.join("\n"));
    setSaveState({ status: "saved" });
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <h2>Blocked words</h2>
      <p>
        One word or phrase per line. A submitted prompt holding any of them,
        whole word and case-insensitive, is refused. Up to{" "}
        {BLOCKED_WORDS_MAX_ENTRIES.toLocaleString()} entries, each up to{" "}
        {BLOCKED_WORDS_MAX_ENTRY_LENGTH} characters.
      </p>

      <label htmlFor="blocked-words-text">Blocked words and phrases</label>
      <textarea
        id="blocked-words-text"
        rows={12}
        value={text}
        onChange={(event) => setText(event.target.value)}
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

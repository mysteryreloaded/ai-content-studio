import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { queryClient } from "./query.js";

/**
 * An SSE event handler. Handlers get the app's `QueryClient`, so an event
 * updates the query cache (`setQueryData`/`invalidateQueries`) rather than
 * component state (spec #33).
 */
export type SseHandler = (data: unknown, queryClient: QueryClient) => void;

/** Event name → handler map for a stream. */
export type SseHandlers = Record<string, SseHandler>;

interface SharedSource {
  source: EventSource;
  /** One per mounted `useEventStream` caller for this url. */
  refcount: number;
  /** Per event name, the handlers of every currently mounted caller. */
  handlers: Map<string, Set<SseHandler>>;
}

/**
 * One shared `EventSource` per url, module-level: this is the only place
 * an `EventSource` is opened, and every `useEventStream` caller in the tab
 * shares it instead of each opening its own, which would burn through
 * HTTP/1.1's six-connections-per-origin limit after just a couple of
 * tabs (issue #59).
 */
const shared = new Map<string, SharedSource>();

function ensureSource(url: string, handlers: SseHandlers): SharedSource {
  const existing = shared.get(url);
  if (existing) return existing;

  const source = new EventSource(url);
  const record: SharedSource = {
    source,
    refcount: 0,
    handlers: new Map(),
  };

  // The only listeners the source gets: dispatch each event to the
  // handlers of every caller currently mounted for this url.
  for (const type of Object.keys(handlers)) {
    source.addEventListener(type, (event) => {
      const data = (event as MessageEvent).data;
      let parsed: unknown = data;
      if (typeof data === "string") {
        try {
          parsed = JSON.parse(data);
        } catch {
          /* keep the raw string */
        }
      }
      const list = record.handlers.get(type);
      if (list) {
        for (const handler of [...list]) handler(parsed, queryClient);
      }
    });
  }

  // A response that isn't 2xx (a 401/403, a 500) leaves the source's
  // readyState at CLOSED, which is exactly the state in which the browser
  // stops reconnecting — so after such an error we never reconnect.
  // Closing explicitly is belt and suspenders for the same guarantee.
  source.addEventListener("error", () => {
    if (source.readyState === source.CLOSED) source.close();
  });

  shared.set(url, record);
  return record;
}

/**
 * Subscribes to the SSE stream at `url` for the lifetime of the mounted
 * component. The stream is shared across every caller of the same url and
 * closes — and stops being shared — when the last caller unmounts.
 */
export function useEventStream(url: string, handlers: SseHandlers): void {
  // The effect registers exactly once per mount ([url] only): a new
  // `handlers` object on re-render doesn't churn the shared source.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const record = ensureSource(url, handlersRef.current);
    const added: Array<{ type: string; handler: SseHandler }> = [];
    for (const [type, handler] of Object.entries(handlersRef.current)) {
      let list = record.handlers.get(type);
      if (!list) {
        list = new Set();
        record.handlers.set(type, list);
      }
      list.add(handler);
      added.push({ type, handler });
    }
    record.refcount++;

    return () => {
      for (const { type, handler } of added) {
        record.handlers.get(type)?.delete(handler);
      }
      record.refcount--;
      if (record.refcount === 0) {
        record.source.close();
        shared.delete(url);
      }
    };
  }, [url]);
}

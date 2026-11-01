import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/**
 * One named SSE event's handler: it receives the subscribing component's
 * own `QueryClient` plus the parsed event data, and updates the query
 * cache (`setQueryData`/`invalidateQueries`) rather than component state
 * (spec #33's "TanStack Query fed by SSE").
 */
export type EventHandler = (queryClient: QueryClient, data: unknown) => void;

/** Event name → handler. */
export type EventHandlers = Record<string, EventHandler>;

interface Subscription {
  client: QueryClient;
  handler: EventHandler;
}

interface SharedStream {
  source: EventSource;
  /** How many mounted components currently share this EventSource. */
  refs: number;
  /** Event name → the subscriptions listening for that event. */
  subscriptions: Map<string, Set<Subscription>>;
}

// Module-level, like the pre-Query `usePauseNotice` singleton (issue
// #59): every `useEventStream` caller with the same URL shares one
// EventSource per tab instead of each opening its own, which would burn
// through HTTP/1.1's six-connections-per-origin limit after a couple of
// tabs.
const streams = new Map<string, SharedStream>();

/**
 * Subscribes to an SSE stream for the duration of the mount; this is
 * the only place an `EventSource` is opened. Handlers are bound at
 * mount (a re-render keeps the original closure — they receive the
 * `QueryClient` as an argument on purpose, so they should write the
 * cache through it rather than through captured state).
 */
export function useEventStream(url: string, handlers: EventHandlers): void {
  const queryClient = useQueryClient();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stream (and its handler bindings) must live for the mount, not re-run on handler identity
  useEffect(() => {
    const mountedHandlers = handlersRef.current;
    let entry = streams.get(url);
    if (!entry) {
      const source = new EventSource(url);
      // EventSource hides the response's status, and its built-in
      // reconnection would loop forever on a 401/403, so peek the status
      // once with a plain fetch (cancelling the body right away): a
      // 401/403 closes the stream, while a dropped connection keeps the
      // built-in retry.
      source.onerror = () => {
        void (async () => {
          try {
            const res = await fetch(url, { method: "GET" });
            const denied = res.status === 401 || res.status === 403;
            await res.body?.cancel();
            if (denied) source.close();
          } catch {
            /* offline: let the built-in reconnection continue */
          }
        })();
      };
      entry = { source, refs: 0, subscriptions: new Map() };
      streams.set(url, entry);
    }

    entry.refs += 1;
    const mine: Array<{ type: string; subscription: Subscription }> = [];
    for (const [type, handler] of Object.entries(mountedHandlers)) {
      const subscription: Subscription = { client: queryClient, handler };
      let set = entry.subscriptions.get(type);
      if (!set) {
        // A fresh `const` so the listener's closure can't see the
        // `set` variable in its possibly-unassigned state.
        const newSet = new Set<Subscription>();
        entry.subscriptions.set(type, newSet);
        entry.source.addEventListener(type, (event: MessageEvent) => {
          let data: unknown;
          try {
            data = JSON.parse(event.data);
          } catch {
            data = event.data;
          }
          for (const s of newSet) s.handler(s.client, data);
        });
        set = newSet;
      }
      set.add(subscription);
      mine.push({ type, subscription });
    }

    return () => {
      for (const { type, subscription } of mine) {
        entry.subscriptions.get(type)?.delete(subscription);
      }
      entry.refs -= 1;
      if (entry.refs === 0) {
        entry.source.close();
        streams.delete(url);
      }
    };
  }, [url]);
}

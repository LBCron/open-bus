import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { qk } from "../api/qk";
import type { AgentsData, MachinesData } from "../api/queries";
import { signOutLocally } from "../api/queryClient";
import { connectBusEvents } from "./busEvents";

/** At most one refetch of both lists per this window, on the trailing edge. */
const REFETCH_WINDOW_MS = 1_000;
/** After a hello, how long a list's greeting snapshot has before we GET it. */
const GREETING_MS = 1_000;

type ListKey = "machines" | "agents";

export type LiveStatus = "connecting" | "live" | "paused";

/**
 * Keeps the machines and agents caches current from the /api/v1/events WebSocket.
 * `status` is "connecting" until the first hello, "live" after a hello, and
 * "paused" while the stream is down (until the next hello). The data on screen
 * stays either way (the initial GET is the source of truth on every mount).
 * Snapshots are server data, so they go straight into the cache; pending
 * revokes are overlaid by `useMachines` on read.
 */
export function useBusEvents() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  // When the stream last dropped, while it stays down; null while live.
  const [pausedAt, setPausedAt] = useState<Date | null>(null);
  const stream = useRef<{ retry(now?: boolean): boolean } | null>(null);

  useEffect(() => {
    let disposed = false;
    let refetchTimer: ReturnType<typeof setTimeout> | undefined;
    let greetingTimer: ReturnType<typeof setTimeout> | undefined;
    // The lists a hello promised a snapshot for that hasn't arrived yet.
    const awaiting = new Set<ListKey>();
    setStatus("connecting");

    const refetchNow = () => {
      clearTimeout(refetchTimer);
      refetchTimer = undefined;
      void qc.invalidateQueries({ queryKey: qk.machines });
      void qc.invalidateQueries({ queryKey: qk.agents });
    };
    // Unknown frames can arrive in bursts: coalesce them into one refetch.
    const refetchSoon = () => {
      if (refetchTimer) return;
      refetchTimer = setTimeout(refetchNow, REFETCH_WINDOW_MS);
    };
    // setQueryData doesn't stop a running fetch, and an older GET resolving
    // later would overwrite this newer snapshot. Cancel first (and wait for the
    // cancel to settle, or its revert would wipe the data we are about to write).
    const write = <T>(key: readonly string[], data: T) => {
      void qc.cancelQueries({ queryKey: key, exact: true }).then(() => {
        if (!disposed) qc.setQueryData<T>(key, data);
      });
    };

    const events = connectBusEvents({
      // The greeting snapshots follow a hello, so a GET now would be wasted.
      // Only a list whose snapshot doesn't arrive in time is refetched.
      onHello: () => {
        setStatus("live");
        setPausedAt(null);
        clearTimeout(refetchTimer);
        refetchTimer = undefined;
        clearTimeout(greetingTimer);
        awaiting.add("machines").add("agents");
        greetingTimer = setTimeout(() => {
          greetingTimer = undefined;
          for (const k of awaiting)
            void qc.invalidateQueries({ queryKey: qk[k] });
          awaiting.clear();
        }, GREETING_MS);
      },
      onSnapshot: (s) => {
        setStatus("live");
        setPausedAt(null);
        awaiting.delete("machines" in s ? "machines" : "agents");
        if ("machines" in s)
          write<MachinesData>(qk.machines, { machines: s.machines });
        else {
          write<AgentsData>(qk.agents, { agents: s.agents });
        }
      },
      onDown: () => {
        setStatus("paused");
        setPausedAt((at) => at ?? new Date());
        // That stream's greeting will never come; the next hello waits anew.
        clearTimeout(greetingTimer);
        awaiting.clear();
        // A refused upgrade hides its 401. Ask /me: if the session is gone,
        // its 401 signs the owner out (makeQueryClient) and unmounts this stream.
        void qc.invalidateQueries({ queryKey: qk.me });
      },
      // 4401: the hub says the session ended. The gate shows sign-in.
      onSignedOut: () => signOutLocally(qc),
      onUnknown: refetchSoon,
    });
    stream.current = events;
    const onFocus = () => {
      if (!document.hidden) events.wake();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      clearTimeout(refetchTimer);
      clearTimeout(greetingTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      events.close();
      if (stream.current === events) stream.current = null;
      setStatus("paused");
    };
  }, [qc]);

  /**
   * The Retry button: connect now if the stream is parked or backing off
   * (see connectBusEvents).
   * True when it reconnected: its greeting will refresh both lists.
   */
  const retry = useCallback(() => stream.current?.retry(true) ?? false, []);

  return { status, retry, pausedAt };
}

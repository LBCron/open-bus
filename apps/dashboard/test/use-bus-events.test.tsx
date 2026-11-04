import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { qk } from "../src/api/qk";
import { makeQueryClient } from "../src/api/queryClient";
import { useBusEvents } from "../src/live/useBusEvents";
import {
  FakeWebSocket,
  installFakeWebSocket,
  lastSocket,
} from "./fakeWebSocket";

const setHidden = (hidden: boolean) =>
  Object.defineProperty(document, "hidden", {
    value: hidden,
    configurable: true,
  });

beforeEach(() => {
  setHidden(false);
  vi.useFakeTimers();
  installFakeWebSocket();
});
afterEach(() => {
  vi.useRealTimers();
});

const machine = {
  id: "machine111111111",
  label: "studio-mbp",
  createdAt: "2026-10-21T10:00:00Z",
  lastUsed: null,
  revokedAt: null,
  connected: false,
};

const setup = (strict = false) => {
  const client = makeQueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
  const view = renderHook(() => useBusEvents(), { wrapper });
  act(() => {
    vi.advanceTimersByTime(0);
  });
  return { client, invalidate, ...view };
};

test("status goes connecting -> live -> paused -> (reconnect) paused -> live", () => {
  const { result } = setup();
  expect(result.current.status).toBe("connecting");
  act(() => lastSocket().push({ type: "hello" }));
  expect(result.current.status).toBe("live");
  act(() => lastSocket().fail());
  expect(result.current.status).toBe("paused");
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(result.current.status).toBe("paused"); // not live until hello
  act(() => lastSocket().push({ type: "hello" }));
  expect(result.current.status).toBe("live");
});

test("a snapshot is written into its own cache only", async () => {
  const { client } = setup();
  await act(async () =>
    lastSocket().push({ type: "machines", machines: [machine] }),
  );
  expect(client.getQueryData(qk.machines)).toEqual({ machines: [machine] });
  expect(client.getQueryData(qk.agents)).toBeUndefined();
});

const listGets = (invalidate: ReturnType<typeof vi.fn>) =>
  invalidate.mock.calls
    .map(([f]) => (f as { queryKey: readonly string[] }).queryKey[0])
    .filter((k) => k !== qk.me[0]);

/** Every key invalidated. */
const keys = (invalidate: ReturnType<typeof vi.fn>) =>
  invalidate.mock.calls.map(
    ([f]) => (f as { queryKey: readonly string[] }).queryKey[0],
  );

test("an unknown frame refetches the lists", () => {
  const { invalidate } = setup();
  act(() => lastSocket().push({ type: "roster_changed" }));
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(keys(invalidate).sort()).toEqual(["agents", "machines"]);
});

test("a missed agents greeting refetches the lists; a missed machines one doesn't", async () => {
  const { invalidate } = setup();
  act(() => lastSocket().push({ type: "hello" }));
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(keys(invalidate).sort()).toEqual(["agents", "machines"]);
  invalidate.mockClear();
  act(() => lastSocket().fail());
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  await act(async () => {
    lastSocket().push({ type: "hello" });
    lastSocket().push({ type: "agents", agents: [] });
  });
  invalidate.mockClear();
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(keys(invalidate)).toEqual(["machines"]);
});

test("an unknown or unreadable frame refetches both lists, once per second", () => {
  const { invalidate } = setup();
  act(() => lastSocket().push({ type: "roster_changed" }));
  expect(invalidate).not.toHaveBeenCalled(); // trailing edge
  act(() => lastSocket().pushRaw("junk"));
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(listGets(invalidate)).toHaveLength(2);
  act(() => lastSocket().push({ type: "roster_changed" }));
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(listGets(invalidate)).toHaveLength(4);
});

test("50 unknown frames coalesce into exactly two invalidations", () => {
  const { invalidate } = setup();
  act(() => {
    for (let i = 0; i < 50; i++) lastSocket().push({ type: `new_${i}` });
  });
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(listGets(invalidate)).toHaveLength(2);
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(listGets(invalidate)).toHaveLength(2);
});

test("unmount clears a pending trailing refetch", () => {
  const { invalidate, unmount } = setup();
  act(() => lastSocket().push({ type: "roster_changed" }));
  unmount();
  vi.advanceTimersByTime(5_000);
  expect(invalidate).not.toHaveBeenCalled();
});

test("hello followed by both greeting snapshots refetches nothing", async () => {
  const { invalidate } = setup();
  await act(async () => {
    lastSocket().push({ type: "hello" });
    lastSocket().push({ type: "machines", machines: [machine] });
    lastSocket().push({ type: "agents", agents: [] });
  });
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(listGets(invalidate)).toEqual([]);
});

test("hello refetches only the lists whose snapshot didn't follow within the window", async () => {
  const { invalidate } = setup();
  await act(async () => {
    lastSocket().push({ type: "hello" });
    lastSocket().push({ type: "machines", machines: [machine] });
  });
  act(() => {
    vi.advanceTimersByTime(999);
  });
  expect(listGets(invalidate)).toEqual([]);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(listGets(invalidate)).toEqual(["agents"]);
});

test("hello with no snapshot refetches both lists once, absorbing a pending trailing refetch", () => {
  const { invalidate } = setup();
  act(() => lastSocket().push({ type: "roster_changed" }));
  act(() => lastSocket().push({ type: "hello" }));
  expect(listGets(invalidate)).toEqual([]);
  act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(listGets(invalidate).sort()).toEqual(["agents", "machines"]);
});

test("an unknown frame after hello still refetches (Decision 2)", async () => {
  const { invalidate } = setup();
  await act(async () => {
    lastSocket().push({ type: "hello" });
    lastSocket().push({ type: "machines", machines: [machine] });
    lastSocket().push({ type: "agents", agents: [] });
  });
  act(() => lastSocket().push({ type: "roster_changed" }));
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(listGets(invalidate).sort()).toEqual(["agents", "machines"]);
});

test("unmount clears a pending hello refetch", () => {
  const { invalidate, unmount } = setup();
  act(() => lastSocket().push({ type: "hello" }));
  unmount();
  vi.advanceTimersByTime(5_000);
  expect(listGets(invalidate)).toEqual([]);
});

test("a hidden tab does not reconnect until it is visible again", () => {
  const { result } = setup();
  act(() => lastSocket().push({ type: "hello" }));
  setHidden(true);
  act(() => lastSocket().fail());
  act(() => {
    vi.advanceTimersByTime(120_000);
  });
  expect(FakeWebSocket.all).toHaveLength(1);
  expect(result.current.status).toBe("paused");
  setHidden(false);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(FakeWebSocket.all).toHaveLength(2);
  act(() => lastSocket().push({ type: "hello" }));
  expect(result.current.status).toBe("live");
});

test("unmount closes the stream; later frames, errors and timers do nothing", async () => {
  const { client, invalidate, unmount } = setup();
  act(() => lastSocket().push({ type: "hello" }));
  const es = lastSocket();
  invalidate.mockClear();
  unmount();
  expect(es.closedWith).toBe(1000);
  es.push({ type: "machines", machines: [machine] });
  es.pushRaw("junk");
  es.fail();
  vi.advanceTimersByTime(60_000);
  await Promise.resolve();
  expect(client.getQueryData(qk.machines)).toBeUndefined();
  expect(invalidate).not.toHaveBeenCalled();
  expect(FakeWebSocket.all).toHaveLength(1);
});

test("unmount during a reconnect timer opens nothing", () => {
  const { unmount } = setup();
  act(() => lastSocket().push({ type: "hello" }));
  act(() => lastSocket().fail());
  unmount();
  vi.advanceTimersByTime(60_000);
  expect(FakeWebSocket.all).toHaveLength(1);
});

test("StrictMode double-mount leaves exactly one open WebSocket", () => {
  setup(true);
  const open = FakeWebSocket.all.filter((s) => !s.closed);
  expect(open).toHaveLength(1);
  expect(FakeWebSocket.all).toHaveLength(1);
});

test("a failed first connect backs off; focus waits, Retry connects now", () => {
  const { result } = setup();
  act(() => lastSocket().fail());
  expect(result.current.status).toBe("paused");
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(FakeWebSocket.all).toHaveLength(1);
  act(() => {
    expect(result.current.retry()).toBe(true);
    expect(result.current.retry()).toBe(false);
  });
  expect(FakeWebSocket.all).toHaveLength(2);
  act(() => lastSocket().push({ type: "hello" }));
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(FakeWebSocket.all).toHaveLength(2);
});

test("coming back to the tab probes an open socket; silence for 5 s pauses and reconnects", () => {
  const { result } = setup();
  const s = lastSocket();
  s.open();
  s.autoPong = false;
  act(() => s.push({ type: "hello" }));
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(s.sent).toEqual(["ping"]);
  act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(result.current.status).toBe("paused");
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(FakeWebSocket.all).toHaveLength(2);
});

test("coming back to the tab with a healthy socket stays live", () => {
  const { result } = setup();
  const s = lastSocket();
  s.open();
  act(() => s.push({ type: "hello" }));
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(s.sent).toEqual(["ping"]);
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(result.current.status).toBe("live");
  expect(FakeWebSocket.all).toHaveLength(1);
});

test("focus listeners are removed on unmount", () => {
  const { unmount } = setup();
  act(() => lastSocket().fail());
  unmount();
  window.dispatchEvent(new Event("focus"));
  expect(FakeWebSocket.all).toHaveLength(1);
});

test("every drop re-checks the session (a refused upgrade hides the 401)", () => {
  const { invalidate } = setup();
  act(() => lastSocket().fail());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.me });
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  act(() => lastSocket().push({ type: "hello" }));
  invalidate.mockClear();
  act(() => lastSocket().fail());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.me });
});

test("a drop before the greeting arrives cancels hello's pending refetch", () => {
  const { invalidate } = setup();
  act(() => lastSocket().push({ type: "hello" }));
  act(() => lastSocket().fail());
  act(() => {
    vi.advanceTimersByTime(900);
  });
  expect(listGets(invalidate)).toEqual([]);
  // The backoff reconnect: its own hello starts a fresh wait.
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(listGets(invalidate)).toEqual([]);
});

test("4401 signs the owner out locally and never reconnects", () => {
  const { client, result } = setup();
  client.setQueryData(qk.me, { email: "a@b.c" });
  client.setQueryData(qk.machines, { machines: [machine] });
  act(() => lastSocket().push({ type: "hello" }));
  act(() => lastSocket().serverClose(4401));
  expect(client.getQueryData(qk.me)).toBeNull();
  expect(client.getQueryData(qk.machines)).toBeUndefined();
  act(() => {
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(120_000);
  });
  expect(result.current.retry()).toBe(false);
  expect(FakeWebSocket.all).toHaveLength(1);
});

test("1013 (evicted) pauses, re-checks the session and reconnects", () => {
  const { client, invalidate, result } = setup();
  client.setQueryData(qk.me, { email: "a@b.c" });
  act(() => lastSocket().push({ type: "hello" }));
  act(() => lastSocket().serverClose(1013));
  expect(result.current.status).toBe("paused");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.me });
  expect(client.getQueryData(qk.me)).not.toBeNull();
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(FakeWebSocket.all).toHaveLength(2);
});

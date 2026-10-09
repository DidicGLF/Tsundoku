// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runSync = vi.fn(async (_options?: { manual?: boolean }) => null as unknown[] | null);
vi.mock("../src/services/sync", () => ({ runSync: (options?: { manual?: boolean }) => runSync(options) }));

import { useAutoSync } from "../src/hooks/useAutoSync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const book = (id: string, updatedAt: string) => ({ id, updatedAt }) as never;

function Probe({ ready, library, setLibrary }: { ready: boolean; library: never[]; setLibrary: (l: never[]) => void }) {
  useAutoSync(ready, library, setLibrary as never);
  return null;
}

let root: Root;
let container: HTMLElement;
const render = (props: { ready: boolean; library: never[]; setLibrary: (l: never[]) => void }) =>
  act(async () => { root.render(createElement(Probe, props)); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  runSync.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

describe("useAutoSync", () => {
  const noop = () => undefined;

  it("does nothing until the database is ready, then syncs once at start", async () => {
    await render({ ready: false, library: [], setLibrary: noop });
    await advance(60_000);
    expect(runSync).not.toHaveBeenCalled();
    await render({ ready: true, library: [], setLibrary: noop });
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("sends a local change a few seconds later, and several quick changes make a single sync", async () => {
    const first = [book("a", "2026-01-01T00:00:00.000Z")];
    await render({ ready: true, library: first, setLibrary: noop });
    await advance(15_000); // le lancement est passé
    runSync.mockClear();

    await render({ ready: true, library: [book("a", "2026-01-01T00:00:10.000Z")], setLibrary: noop });
    await advance(2_000);
    await render({ ready: true, library: [book("a", "2026-01-01T00:00:12.000Z")], setLibrary: noop });
    await advance(3_000);
    expect(runSync).not.toHaveBeenCalled(); // 3 s après la dernière modification : pas encore
    await advance(2_000);
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("does not resync because of what the sync itself brought in", async () => {
    runSync.mockResolvedValueOnce([book("a", "2026-02-01T00:00:00.000Z")]);
    let current: never[] = [];
    const setLibrary = (next: never[]) => { current = next; };
    await render({ ready: true, library: [], setLibrary });
    await advance(0);
    expect(current).toHaveLength(1);
    await render({ ready: true, library: current, setLibrary });
    runSync.mockClear();
    await advance(8_000);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("checks the server every 30 seconds, and as soon as the network comes back", async () => {
    await render({ ready: true, library: [], setLibrary: noop });
    runSync.mockClear();
    await advance(31_000);
    expect(runSync).toHaveBeenCalledTimes(1);

    runSync.mockClear();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(runSync).toHaveBeenCalledTimes(1);
  });
});

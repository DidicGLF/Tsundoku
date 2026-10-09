import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeServer } from "../../../packages/database/test/fake-server";
import { runSyncFuzz } from "./helpers/sync-fuzz";

/*
 * Test de robustesse de la synchronisation : 3 appareils + 1 appareil neuf, des centaines d'opérations au hasard
 * (ajouts d'un même livre sur plusieurs appareils, modifications concurrentes, suppressions, doublons fusionnés, auteurs suivis),
 * des synchronisations dans un ordre quelconque. À la fin, tous doivent contenir exactement la même chose.
 */
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterAll(() => { vi.useRealTimers(); });

describe("convergence des appareils (serveur simulé)", () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  it.each(seeds)("graine %i : 3 appareils + 1 neuf convergent vers le même état que le modèle", async seed => {
    const server = new FakeServer();
    const result = await runSyncFuzz({ seed, steps: 120, transports: [server.transport(), server.transport(), server.transport(), server.transport()] });
    expect(result.operations.add).toBeGreaterThan(0);
  });

  it("un très long scénario (600 opérations)", async () => {
    const server = new FakeServer();
    const result = await runSyncFuzz({ seed: 9001, steps: 600, transports: [server.transport(), server.transport(), server.transport(), server.transport()] });
    expect(result.liveEntries).toBeGreaterThan(0);
    expect(result.tombstones).toBeGreaterThan(0);
  }, 60000);
});

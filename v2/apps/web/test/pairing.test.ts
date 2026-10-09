import { describe, expect, it } from "vitest";
import { formatPairingCode, generatePairingCode, normalizePairingCode, openKey, pairingIdOf, sealKey } from "../src/lib/pairing";
import { generateSyncKey } from "../src/lib/sync-key";

describe("pairing code", () => {
  it("is 8 unambiguous characters, formatted in two groups", () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
    expect(formatPairingCode("K7M4QX2R")).toBe("K7M4-QX2R");
  });
  it("is different every time and uses the whole alphabet without bias", () => {
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      const code = generatePairingCode();
      seen.add(code);
      for (const char of code) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(seen.size).toBe(2000);
    expect(counts.size).toBe(31);
    const values = [...counts.values()];
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.4);
  });
  it("accepts what a person types", () => {
    expect(normalizePairingCode("k7m4-qx2r")).toBe("K7M4QX2R");
    expect(normalizePairingCode(" K7M4 QX2R ")).toBe("K7M4QX2R");
    expect(normalizePairingCode("K7M4QX2")).toBeUndefined();
    expect(normalizePairingCode("K7M4QX2R9")).toBeUndefined();
    expect(normalizePairingCode("K7M4-QX20")).toBeUndefined(); // 0 n'existe pas dans l'alphabet
    expect(normalizePairingCode(generateSyncKey())).toBeUndefined();
  });
});

describe("sealing the sync key", () => {
  it("round-trips, with an id that does not reveal the code or the key", async () => {
    const code = generatePairingCode();
    const key = generateSyncKey();
    const { id, payload } = await sealKey(code, key);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id + payload).not.toContain(code);
    expect(payload).not.toContain(key);
    expect(await pairingIdOf(code)).toBe(id);
    expect(await openKey(code, payload)).toBe(key);
  });
  it("fails with another code and never gives the key away", async () => {
    const { payload } = await sealKey("AAAAAAAA", generateSyncKey());
    await expect(openKey("BBBBBBBB", payload)).rejects.toThrow(/ne correspond pas/);
  });
  it("uses a fresh nonce each time", async () => {
    const key = generateSyncKey();
    expect((await sealKey("AAAAAAAA", key)).payload).not.toBe((await sealKey("AAAAAAAA", key)).payload);
  });
});

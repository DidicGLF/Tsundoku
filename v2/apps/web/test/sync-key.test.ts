import { describe, expect, it } from "vitest";
import qrcode from "qrcode-generator";
import { generateSyncKey, parseSyncKey } from "../src/lib/sync-key";

describe("sync key", () => {
  it("generates 43 URL-safe characters, different every time, and accepts them back", () => {
    const a = generateSyncKey();
    const b = generateSyncKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(parseSyncKey(a)).toBe(a);
  });
  it("tolerates surrounding spaces and rejects anything else", () => {
    const key = generateSyncKey();
    expect(parseSyncKey(`  ${key}\n`)).toBe(key);
    expect(parseSyncKey("trop court")).toBeUndefined();
    expect(parseSyncKey(`${key} ${key}`)).toBeUndefined();
    expect(parseSyncKey("é".repeat(40))).toBeUndefined();
  });
  it("fits in a QR code", () => {
    const qr = qrcode(0, "M");
    qr.addData(generateSyncKey());
    qr.make();
    expect(qr.createSvgTag({ scalable: true })).toContain("<svg");
  });
});

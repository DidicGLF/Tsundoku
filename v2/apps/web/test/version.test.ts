import { describe, expect, it } from "vitest";
import { appVersion, cleanVersion, versionCode, versionFromDescribe } from "../../../scripts/version.mjs";

describe("version from git tags", () => {
  it("cleans a tag into a version", () => {
    expect(cleanVersion("v0.3.0")).toBe("0.3.0");
    expect(cleanVersion("0.3.0")).toBe("0.3.0");
    expect(cleanVersion("v1.0.0-beta.1")).toBe("1.0.0-beta.1");
    expect(cleanVersion("latest")).toBeUndefined();
    expect(cleanVersion("v1.2")).toBeUndefined();
    expect(cleanVersion(undefined)).toBeUndefined();
  });

  it("reads git describe: exactly on a tag, or some commits after it", () => {
    expect(versionFromDescribe("v0.2.0-0-g9b353ef\n")).toBe("0.2.0");
    expect(versionFromDescribe("v0.2.0-7-gabc1234")).toBe("0.2.0-dev.7");
    expect(versionFromDescribe("abc1234")).toBeUndefined();
    expect(versionFromDescribe("")).toBeUndefined();
  });

  it("takes the environment first (what the release workflow sets from the tag)", () => {
    expect(appVersion({ APP_VERSION: "v0.9.1" })).toBe("0.9.1");
    expect(appVersion({ APP_VERSION: "n'importe quoi" })).toMatch(/^\d+\.\d+\.\d+/); // retombe sur git ou package.json
  });

  it("computes an Android versionCode that always grows with the version", () => {
    expect(versionCode("0.2.0")).toBe(200);
    expect(versionCode("0.2.1")).toBe(201);
    expect(versionCode("0.3.0")).toBe(300);
    expect(versionCode("1.0.0")).toBe(10000);
    expect(versionCode("0.3.0-dev.7")).toBe(300);
    const order = ["0.2.0", "0.2.9", "0.3.0", "0.10.0", "1.0.0", "1.2.3"].map(versionCode);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(() => versionCode("0.100.0")).toThrow();
    expect(() => versionCode("0.1.100")).toThrow();
  });
});

describe("comparing versions in the app", () => {
  it("orders X.Y.Z versions and ignores suffixes", async () => {
    const { compareVersions } = await import("../src/lib/app-version");
    expect(compareVersions("0.3.0", "0.2.9")).toBeGreaterThan(0);
    expect(compareVersions("v0.2.1", "0.2.0")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.3.0-dev.4", "0.3.0")).toBe(0);
  });
});

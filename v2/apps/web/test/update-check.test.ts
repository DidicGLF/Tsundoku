// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));

import { checkForUpdate, dismissUpdate, knownUpdate, latestVersionOf, shouldNotify } from "../src/services/updateCheck";

const response = (tag: unknown, ok = true) => ({ ok, json: async () => ({ tag_name: tag }) }) as Response;
const DAY = 24 * 3600 * 1000;

beforeEach(() => localStorage.clear());

describe("update check", () => {
  it("reads the version of the latest release", () => {
    expect(latestVersionOf({ tag_name: "v0.3.0" })).toBe("0.3.0");
    expect(latestVersionOf({ tag_name: "0.3.0" })).toBe("0.3.0");
    expect(latestVersionOf({ tag_name: "v0.3.0-beta.1" })).toBeUndefined();
    expect(latestVersionOf({ message: "rate limited" })).toBeUndefined();
    expect(latestVersionOf(null)).toBeUndefined();
  });

  it("notifies only for a newer version that was not dismissed, and never from a dev build", () => {
    expect(shouldNotify("0.2.0", "0.3.0", null)).toBe(true);
    expect(shouldNotify("0.3.0", "0.3.0", null)).toBe(false);
    expect(shouldNotify("0.3.1", "0.3.0", null)).toBe(false);
    expect(shouldNotify("0.2.0", "0.3.0", "0.3.0")).toBe(false);
    expect(shouldNotify("0.2.0", "0.4.0", "0.3.0")).toBe(true);
    expect(shouldNotify("0.2.0", undefined, null)).toBe(false);
    expect(shouldNotify("dev", "9.9.9", null)).toBe(false);
    expect(shouldNotify("0.0.0-test", "9.9.9", null)).toBe(false);
  });

  it("asks GitHub at most once a day and remembers the answer", async () => {
    const fetchImpl = vi.fn(async () => response("v0.3.0"));
    // dans les tests l'application est en version « 0.0.0-test » : jamais de bandeau, mais la réponse est mémorisée
    expect(await checkForUpdate(1000, fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await checkForUpdate(1000 + DAY / 2, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await checkForUpdate(1000 + DAY + 1, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("tsundoku.update.available")).toBe("0.3.0");
  });

  it("shows the known update without network, until it is dismissed", () => {
    localStorage.setItem("tsundoku.update.available", "0.3.0");
    expect(knownUpdate("0.2.0")).toEqual({ version: "0.3.0" });
    dismissUpdate("0.3.0");
    expect(knownUpdate("0.2.0")).toBeNull();
    localStorage.setItem("tsundoku.update.available", "0.4.0");
    expect(knownUpdate("0.2.0")).toEqual({ version: "0.4.0" });
  });

  it("stays silent when offline or when GitHub answers an error, and retries at the next launch", async () => {
    const failing = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(checkForUpdate(5000, failing)).resolves.toBeNull();
    const refused = vi.fn(async () => response("v0.3.0", false));
    await expect(checkForUpdate(6000, refused)).resolves.toBeNull();
    expect(localStorage.getItem("tsundoku.update.checkedAt")).toBeNull();
  });
});

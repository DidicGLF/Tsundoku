import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson, getText } from "../src/http";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("http", () => {
  it("retries once on a transient status then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(ok({ a: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getJson("https://example.org/x")).resolves.toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not retry a 500 (the BnF answers 500 past the last record)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getText("https://example.org/x")).rejects.toThrow("HTTP 500");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retries a network error once, then gives up", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getText("https://example.org/x")).rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("aborts a stalled request instead of waiting forever", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    await expect(getText("https://example.org/x", { timeoutMs: 20, retries: 0 })).rejects.toThrow("Délai dépassé");
  });
});

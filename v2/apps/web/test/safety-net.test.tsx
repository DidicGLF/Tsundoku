// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setLibrary = vi.fn();
const deleteWholeLibrary = vi.fn(async () => 2);
const restoreDeletedBooks = vi.fn(async (_books: unknown[]) => [{ id: "a" }] as unknown[]);
let deleted = [
  { id: "d1", title: "Fondation", authors: ["Isaac Asimov"], deletedAt: "2026-10-09T09:10:14.000Z" },
  { id: "d2", title: "Les Robots", authors: ["Isaac Asimov"], deletedAt: "2026-10-09T09:10:20.000Z" },
  { id: "d3", title: "Dune", authors: ["Frank Herbert"], deletedAt: "2026-10-09T09:01:00.000Z" }
];
let syncOn = false;

vi.mock("../src/services/library", () => ({
  deleteWholeLibrary: () => deleteWholeLibrary(),
  listRecentlyDeletedBooks: async () => deleted,
  restoreDeletedBooks: (books: unknown[]) => restoreDeletedBooks(books)
}));
vi.mock("../src/services/sync", () => ({ isSyncEnabled: () => syncOn }));
vi.mock("../src/state/LibraryProvider", () => ({
  useLibrary: () => ({ library: [{ id: "a" }, { id: "b" }], setLibrary, dbState: "ready" })
}));

import { DangerZone } from "../src/components/DangerZone";
import { DeletedBooks } from "../src/components/DeletedBooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
const mount = (element: ReturnType<typeof createElement>) => act(async () => { root.render(element); });
const buttons = () => [...container.querySelectorAll("button")];
const byText = (text: string) => buttons().find(button => button.textContent?.includes(text));
const type = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setLibrary.mockClear(); deleteWholeLibrary.mockClear(); restoreDeletedBooks.mockClear();
  syncOn = false;
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("DangerZone", () => {
  it("needs the word to be typed before the library can be deleted, then empties it", async () => {
    await mount(createElement(DangerZone));
    await act(async () => { byText("Supprimer toute ma bibliothèque…")!.click(); });
    const confirm = byText("Tout supprimer")!;
    expect(confirm.disabled).toBe(true);
    const input = container.querySelector("input")!;
    await type(input, "supprim");
    expect(byText("Tout supprimer")!.disabled).toBe(true);
    await type(input, "supprimer"); // la casse n'a pas d'importance
    expect(byText("Tout supprimer")!.disabled).toBe(false);
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(deleteWholeLibrary).toHaveBeenCalledTimes(1);
    expect(setLibrary).toHaveBeenCalledWith([]);
    expect(container.textContent).toContain("2 livres supprimés");
    expect(container.textContent).toContain("30 jours");
  });

  it("mentions the other devices only when sync is on, and can be cancelled without deleting", async () => {
    syncOn = true;
    await mount(createElement(DangerZone));
    await act(async () => { byText("Supprimer toute ma bibliothèque…")!.click(); });
    expect(container.textContent).toContain("2 livres");
    expect(container.textContent).toContain("autres appareils");
    await act(async () => { byText("Annuler")!.click(); });
    expect(deleteWholeLibrary).not.toHaveBeenCalled();
    expect(container.querySelector("input")).toBeNull();
  });
});

describe("DeletedBooks", () => {
  it("lists removed books by author and restores a whole author or a single book", async () => {
    await mount(createElement(DeletedBooks));
    expect(container.textContent).not.toContain("Isaac Asimov");
    await act(async () => { byText("Voir les livres supprimés")!.click(); });
    const groups = [...container.querySelectorAll(".deleted-group summary")].map(summary => summary.textContent);
    expect(groups[0]).toContain("Isaac Asimov");
    expect(groups[0]).toContain("2 livres");
    expect(groups[1]).toContain("Frank Herbert");

    await act(async () => { byText("Restaurer les 2 livres")!.click(); });
    expect(restoreDeletedBooks).toHaveBeenCalledTimes(1);
    expect((restoreDeletedBooks.mock.calls[0][0] as Array<{ id: string }>).map(b => b.id).sort()).toEqual(["d1", "d2"]);
    expect(setLibrary).toHaveBeenCalled();

    restoreDeletedBooks.mockClear();
    await act(async () => { [...container.querySelectorAll("li button")].find(b => b.closest("li")?.textContent?.includes("Dune"))!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect((restoreDeletedBooks.mock.calls[0][0] as Array<{ id: string }>).map(b => b.id)).toEqual(["d3"]);
  });

  it("says so when nothing was removed recently", async () => {
    deleted = [];
    await mount(createElement(DeletedBooks));
    await act(async () => { byText("Voir les livres supprimés")!.click(); });
    expect(container.textContent).toContain("Aucun livre supprimé");
  });
});

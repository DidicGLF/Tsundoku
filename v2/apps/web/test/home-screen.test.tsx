// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let library: unknown[] = [];

vi.mock("../src/state/LibraryProvider", () => ({ useLibrary: () => ({ library, dbState: "ready" }) }));
vi.mock("../src/state/NavigationProvider", () => ({ useNavigation: () => ({ push, reset: vi.fn() }) }));
vi.mock("../src/components/UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("../src/services/backup", () => ({ dismissBackupNudge: vi.fn(), shouldNudgeBackup: () => false }));

import { HomeScreen } from "../src/screens/HomeScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
const filters = { setFilter: vi.fn() } as never;
const book = (id: string, over: object = {}) => ({
  id, source: "open-library", sourceId: id, title: `Titre ${id}`, authors: ["Maxime Chattam"], status: "TO_READ",
  favorite: false, owned: true, newlyDiscovered: false, addedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over
});
const mount = () => act(async () => { root.render(createElement(HomeScreen, { filters })); });

beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); push.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("accueil", () => {
  it("affiche les derniers ajouts (livres possédés) et les nouveautés", async () => {
    library = [book("a", { addedAt: "2026-03-01T00:00:00Z" }), book("b"), book("n", { owned: false, newlyDiscovered: true, publishedYear: 2026 })];
    await mount();
    expect(container.textContent).toContain("Nouveautés");
    expect(container.textContent).toContain("Derniers ajouts");
    const tiles = container.querySelectorAll(".recent-row .tile");
    expect(tiles).toHaveLength(2);
    await act(async () => { (tiles[0] as HTMLElement).click(); });
    expect(push).toHaveBeenCalledWith({ name: "detail", id: "a" });
  });

  it("sans nouveauté, seuls les derniers ajouts s'affichent", async () => {
    library = [book("a")];
    await mount();
    expect(container.textContent).not.toContain("Nouveautés");
    expect(container.textContent).toContain("Derniers ajouts");
  });
});

import { describe, expect, it } from "vitest";
import { canGoBack, currentRoute, initialNavState, navReducer, type NavAction, type NavState } from "../src/state/navigation";

const run = (...actions: NavAction[]): NavState => actions.reduce(navReducer, initialNavState);
const names = (state: NavState) => state.stack.map(r => r.name);

describe("navigation stack", () => {
  it("starts on home and cannot go back", () => {
    expect(currentRoute(initialNavState)).toEqual({ name: "home" });
    expect(canGoBack(initialNavState)).toBe(false);
    expect(run({ type: "back" })).toBe(initialNavState);
  });
  it("tabs restart from home, so back always returns home", () => {
    const state = run({ type: "reset", route: { name: "library" } });
    expect(names(state)).toEqual(["home", "library"]);
    expect(names(navReducer(state, { type: "back" }))).toEqual(["home"]);
    expect(names(run({ type: "reset", route: { name: "library" } }, { type: "reset", route: { name: "add" } }))).toEqual(["home", "add"]);
  });
  it("goes back through library -> author -> detail", () => {
    const state = run(
      { type: "reset", route: { name: "library" } },
      { type: "push", route: { name: "author", key: "frank herbert", authorName: "Frank Herbert" } },
      { type: "push", route: { name: "detail", id: "b1" } }
    );
    expect(names(state)).toEqual(["home", "library", "author", "detail"]);
    const back = navReducer(state, { type: "back" });
    expect(currentRoute(back)).toMatchObject({ name: "author", key: "frank herbert" });
    expect(currentRoute(navReducer(back, { type: "back" }))).toEqual({ name: "library" });
  });
  it("resetting to home empties the history", () => {
    expect(names(run({ type: "reset", route: { name: "add" } }, { type: "reset", route: { name: "home" } }))).toEqual(["home"]);
  });
});

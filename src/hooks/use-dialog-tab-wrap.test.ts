import { describe, expect, it } from "vitest";
import { wrapTabIndex } from "./use-dialog-tab-wrap";

/**
 * Issue #149: Base UI's dialog focus guards refocus via rAF, so a fast Tab
 * can slip out of the dialog. useDialogTabWrap wraps Tab synchronously at the
 * popup boundary; wrapTabIndex is the pure decision it makes.
 */
describe("wrapTabIndex", () => {
  it("leaves interior Tab presses to the browser", () => {
    expect(wrapTabIndex(0, 5, false)).toBeNull();
    expect(wrapTabIndex(3, 5, false)).toBeNull();
    expect(wrapTabIndex(4, 5, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first tabbable to the last", () => {
    expect(wrapTabIndex(0, 5, true)).toBe(4);
  });

  it("wraps Tab from the last tabbable to the first", () => {
    expect(wrapTabIndex(4, 5, false)).toBe(0);
  });

  it("wraps in a single-tabbable dialog", () => {
    expect(wrapTabIndex(0, 1, false)).toBe(0);
    expect(wrapTabIndex(0, 1, true)).toBe(0);
  });

  it("defers to Base UI when focus is not on a tabbable of this popup", () => {
    // -1 = activeElement was not found among the popup's tabbables (e.g. it is
    // on a Base UI focus-guard span or outside the dialog entirely).
    expect(wrapTabIndex(-1, 5, false)).toBeNull();
    expect(wrapTabIndex(-1, 5, true)).toBeNull();
  });

  it("defers when the popup has no tabbables", () => {
    expect(wrapTabIndex(-1, 0, false)).toBeNull();
  });
});

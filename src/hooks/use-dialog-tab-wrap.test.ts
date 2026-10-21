import { describe, expect, it } from "vitest";
import { nextTabTarget, type TabOrigin } from "./use-dialog-tab-wrap";

/**
 * Issue #149: Base UI's dialog focus guards refocus via rAF, so a fast Tab
 * can slip out of the dialog. useDialogTabWrap wraps Tab synchronously at the
 * popup boundary; nextTabTarget is the pure decision it makes.
 */
const item = (index: number): TabOrigin => ({ kind: "item", index });
const popup: TabOrigin = { kind: "popup" };
const outside: TabOrigin = { kind: "outside" };

describe("nextTabTarget", () => {
  it("leaves interior Tab presses to the browser", () => {
    expect(nextTabTarget(item(0), 5, false)).toBeNull();
    expect(nextTabTarget(item(3), 5, false)).toBeNull();
  });

  it("wraps Tab from the last tabbable to the first", () => {
    expect(nextTabTarget(item(4), 5, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first tabbable to the last", () => {
    expect(nextTabTarget(item(0), 5, true)).toBe(4);
  });

  it("wraps in a single-tabbable dialog", () => {
    expect(nextTabTarget(item(0), 1, false)).toBe(0);
    expect(nextTabTarget(item(0), 1, true)).toBe(0);
  });

  it("defers to Base UI when focus is on a guard span or outside the dialog", () => {
    expect(nextTabTarget(outside, 5, false)).toBeNull();
    expect(nextTabTarget(outside, 5, true)).toBeNull();
  });

  it("wraps Shift+Tab from the popup container to the last tabbable", () => {
    // Shift+Tab from the popup would reach Base UI's before-guard and re-enter
    // the rAF race; forward Tab from the popup lands on the first tabbable
    // anyway, so the browser default is correct.
    expect(nextTabTarget(popup, 5, true)).toBe(4);
    expect(nextTabTarget(popup, 5, false)).toBeNull();
  });

  it("does nothing when the popup has no tabbables", () => {
    expect(nextTabTarget(outside, 0, false)).toBeNull();
    expect(nextTabTarget(popup, 0, true)).toBeNull();
    expect(nextTabTarget(item(0), 0, false)).toBeNull();
  });
});

"use client"

import * as React from "react";

/**
 * Synchronous Tab wrap for modal dialogs (issue #149).
 *
 * Base UI traps focus with invisible guard spans around the popup and
 * refocuses into the dialog from a `requestAnimationFrame` callback
 * (`enqueueFocus` in @base-ui/react). A Tab keypress landing in that
 * one-frame window slips past the guard: `activeElement` escapes to the page
 * behind the dialog and is only pulled back on a later Tab. Wrapping the
 * boundary transition ourselves — synchronously, inside the keydown handler —
 * means focus never reaches the guard spans at all, so the race cannot occur.
 *
 * Interior Tab presses are left to the browser: default focus order inside a
 * dialog is already correct.
 */
export type TabOrigin =
  | { kind: "item"; index: number }
  | { kind: "popup" } // focus is on the popup container itself
  | { kind: "outside" }; // focus is on a guard span or outside the dialog

/**
 * Where Tab/Shift+Tab should land, as a tabbable index, or null when the
 * browser's default behavior should run untouched.
 */
export function nextTabTarget(
  origin: TabOrigin,
  itemCount: number,
  shiftKey: boolean
): number | null {
  if (origin.kind === "outside" || itemCount === 0) {
    return null; // Base UI's guards own this transition
  }
  if (origin.kind === "popup") {
    // Tab: the first tabbable is next anyway. Shift+Tab would reach the
    // before-guard, re-entering the rAF race — wrap to the last tabbable.
    return shiftKey ? itemCount - 1 : null;
  }
  const nextIndex = origin.index + (shiftKey ? -1 : 1);
  if (nextIndex >= 0 && nextIndex < itemCount) {
    return null; // interior move: browser order is correct
  }
  return shiftKey ? itemCount - 1 : 0;
}

const TABBABLE_SELECTOR =
  'a[href], button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

function getTabbables(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)
  ).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      el.getClientRects().length > 0
  );
  // Radio groups: browsers offer one tab stop per group — the checked radio,
  // or the first one when none is checked. Keep only that entry.
  return candidates.filter((el) => {
    if (
      !(el instanceof HTMLInputElement) ||
      el.type !== "radio" ||
      !el.name
    ) {
      return true;
    }
    const group = candidates.filter(
      (c): c is HTMLInputElement =>
        c instanceof HTMLInputElement &&
        c.type === "radio" &&
        c.name === el.name
    );
    const stop = group.find((radio) => radio.checked) ?? group[0];
    return el === stop;
  });
}

export function useDialogTabWrap(
  popupRef: React.RefObject<HTMLElement | null>
) {
  return React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
      const popup = popupRef.current;
      if (!popup) {
        return;
      }
      const tabbables = getTabbables(popup);
      const active = document.activeElement;
      const activeIndex = tabbables.indexOf(active as HTMLElement);
      const origin: TabOrigin =
        active === popup
          ? { kind: "popup" }
          : activeIndex === -1
            ? { kind: "outside" }
            : { kind: "item", index: activeIndex };
      const target = nextTabTarget(origin, tabbables.length, event.shiftKey);
      if (target === null) {
        return;
      }
      event.preventDefault();
      tabbables[target].focus();
    },
    [popupRef]
  );
}

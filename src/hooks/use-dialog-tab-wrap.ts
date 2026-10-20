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
 * dialog is already correct. Returns the index to focus, or null when the
 * browser's default Tab behavior should run untouched.
 */
export function wrapTabIndex(
  currentIndex: number,
  itemCount: number,
  shiftKey: boolean
): number | null {
  if (currentIndex < 0 || itemCount === 0) {
    return null; // focus is not on a tabbable of this popup; Base UI owns it
  }
  const nextIndex = currentIndex + (shiftKey ? -1 : 1);
  if (nextIndex >= 0 && nextIndex < itemCount) {
    return null; // interior move: browser order is correct
  }
  return shiftKey ? itemCount - 1 : 0;
}

const TABBABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function getTabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)
  ).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.hasAttribute("disabled") &&
      el.getClientRects().length > 0
  );
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
      const target = wrapTabIndex(
        tabbables.indexOf(document.activeElement as HTMLElement),
        tabbables.length,
        event.shiftKey
      );
      if (target === null) {
        return;
      }
      event.preventDefault();
      tabbables[target].focus();
    },
    [popupRef]
  );
}

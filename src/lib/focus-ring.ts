/**
 * The keyboard focus indicator for every interactive control in `src/`
 * (issue #180).
 *
 * ## Why this exists
 *
 * The shadcn "base-nova" ui kit paints a 3px ring on keyboard focus
 * (`focus-visible:ring-3 focus-visible:ring-ring/50` plus `outline-none`, see
 * `src/components/ui/button.tsx`). Every hand-written `<button>` in the app
 * declared **no** focus style at all, so keyboard focus showed only the
 * browser's 1px default outline — easy to miss on the beige and dark
 * backgrounds. A handful of hand-written controls declared a 2px ring or a 2px
 * outline, which is the same problem one step down.
 *
 * ## Why one shared constant
 *
 * The classes are pasted at every call site otherwise, and they drift: a
 * hand-written button ends up with a 2px ring while the ui kit next to it has
 * 3px. One constant keeps every control on the same indicator, and the
 * regression test in `src/lib/focus-ring.test.ts` fails when a raw `<button>`
 * in `src/` is added without it.
 *
 * ## Why `outline-none` and not `focus-visible:outline-none`
 *
 * `outline-none` is Tailwind's `outline: 2px solid transparent` — the outline
 * is removed but the space is kept, exactly as the ui kit does it. It also
 * stops the browser's 1px outline from being painted *under* the ring, so the
 * control shows one indicator rather than two.
 *
 * The ring colour comes from the `--ring` theme token, so it follows the
 * light/dark switch the same way the ui kit's ring does.
 */
export const focusRingClass =
  "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

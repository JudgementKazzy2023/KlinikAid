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

/**
 * The keyboard focus indicator for a control that a clipping edge can cut
 * off (issue #192).
 *
 * ## Why this exists
 *
 * `focusRingClass` paints a **ring**, and a ring is a box shadow: it is drawn
 * *outside* the control's border box. That is the wrong place for a control
 * that sits against an edge the browser clips at:
 *
 *   - the first card of a kanban column is flush with the top of the column's
 *     scrollport, so the top of its ring was cut off;
 *   - the System Event Log scroller on /admin/dashboard fills its Card's
 *     padding box, and the Card is `overflow-hidden`, so the left and right of
 *     its outline were cut off;
 *   - the table scroller on /admin/logs sits inside a parent with the
 *     identical box, so its outline was cut off on all four sides.
 *
 * ## Why an outline and not an inset ring
 *
 * `focus-visible:ring-inset` would also draw the indicator inside the
 * control, but a ring is a box shadow, and a box shadow paints *under* the
 * element's content. The table's header row has its own background, so an
 * inset ring would have been half-hidden under it. An **outline** paints over
 * the content (CSS 2.1 Appendix E paints outlines last), so nothing the
 * control contains can hide it.
 *
 * `outline-offset: -3px` moves the 3px outline *into* the control's own box.
 * Nothing outside the box can clip what is inside it, so the indicator
 * survives every ancestor: a scroll region, an `overflow-hidden` wrapper, the
 * edge of the viewport.
 *
 * ## Why the same 3px and the same colour
 *
 * The width and the colour are the ones the app-wide floor in
 * `src/app/globals.css` uses (`3px solid hsl(var(--ring))`), so this indicator
 * is the floor's indicator, only drawn inside the control instead of outside
 * it. `outline-none` keeps the floor's own (outset) outline away, so the
 * control shows exactly one indicator.
 */
export const focusRingInsetClass =
  "outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-ring";

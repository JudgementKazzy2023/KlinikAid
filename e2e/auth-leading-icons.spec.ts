import { expect, test } from "@playwright/test";

/**
 * Issue #152: the decorative leading icons on the auth forms are absolutely
 * positioned over their field, so without pointer-events-none a tap lands on
 * the SVG and the field never focuses. Each icon must be inert to the pointer
 * and let the hit test reach the control underneath it.
 *
 * `/reset-password` needs a single-use recovery link and `/privacy-agreement`
 * needs a signed-in, not-yet-consented patient, so neither can run here; their
 * markup is guarded by src/app/(auth)/auth-decorations.test.ts and both were
 * measured in a live session for the issue.
 */

const viewports = [
  { name: "430x932", width: 430, height: 932 },
  { name: "1280x800", width: 1280, height: 800 },
];

const routes = [
  { route: "/register", ready: "#firstName", icons: 7 },
  { route: "/login", ready: "#email", icons: 2 },
  { route: "/forgot-password", ready: "#email", icons: 1 },
];

type IconProbe = {
  controlTag: string;
  controlId: string;
  pointerEvents: string;
  ariaHidden: string | null;
  hit: string;
  hitIsControl: boolean;
  visible: boolean;
};

// Serialised into the page by Playwright: every one is self-contained.
/** How many decorative leading icons the page rendered. */
const COUNT_ICONS = () =>
  Array.from(document.querySelectorAll("svg.lucide")).filter((svg) => {
    if (getComputedStyle(svg).position !== "absolute") return false;
    return Boolean(svg.parentElement && svg.parentElement.querySelector("input, select, textarea"));
  }).length;

/** One icon's style, aria state, and what the hit test returns at its centre. */
const PROBE_ICON = (index: number) => {
  const icons = Array.from(document.querySelectorAll("svg.lucide")).filter((svg) => {
    if (getComputedStyle(svg).position !== "absolute") return false;
    return Boolean(svg.parentElement && svg.parentElement.querySelector("input, select, textarea"));
  });
  const svg = icons[index];
  if (!svg) return null;
  const control = svg.parentElement!.querySelector("input, select, textarea")!;
  const style = getComputedStyle(svg);
  svg.scrollIntoView({ block: "center", inline: "nearest" });
  const rect = svg.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    controlTag: control.tagName.toLowerCase(),
    controlId: control.id,
    pointerEvents: style.pointerEvents,
    ariaHidden: svg.getAttribute("aria-hidden"),
    hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}` : "null",
    hitIsControl: hit === control,
    visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth,
  } satisfies IconProbe;
};

/** Viewport coordinates of one icon's centre, after scrolling it into view. */
const CLICK_ICON = (index: number) => {
  const icons = Array.from(document.querySelectorAll("svg.lucide")).filter((svg) => {
    if (getComputedStyle(svg).position !== "absolute") return false;
    return Boolean(svg.parentElement && svg.parentElement.querySelector("input, select, textarea"));
  });
  const svg = icons[index];
  if (!svg) return null;
  svg.scrollIntoView({ block: "center", inline: "nearest" });
  const rect = svg.getBoundingClientRect();
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
};

/** A printable identity for document.activeElement, for the focus assertion. */
const ACTIVE_ELEMENT = () => {
  const element = document.activeElement;
  return element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}` : "null";
};

for (const viewport of viewports) {
  for (const { route, ready, icons } of routes) {
    test(`leading icons on ${route} at ${viewport.name} pass clicks to their field`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route);
      await page.waitForSelector(ready);

      expect(await page.evaluate(COUNT_ICONS), "leading icon count").toBe(icons);

      for (let index = 0; index < icons; index += 1) {
        const probe: IconProbe | null = await page.evaluate(PROBE_ICON, index);
        expect(probe, `icon ${index + 1} disappeared`).not.toBeNull();
        const { controlTag, controlId } = probe!;
        const label = `icon ${index + 1}/${icons} (${controlTag}#${controlId}) on ${route} at ${viewport.name}`;

        expect(probe!.pointerEvents, `${label}: pointer-events`).toBe("none");
        expect(probe!.ariaHidden, `${label}: aria-hidden`).toBe("true");
        expect(probe!.visible, `${label}: icon is inside the viewport`).toBe(true);
        expect(probe!.hitIsControl, `${label}: elementFromPoint returned ${probe!.hit}`).toBe(true);

        const point = await page.evaluate(CLICK_ICON, index);
        expect(point, `${label}: icon lost before the click`).not.toBeNull();
        await page.mouse.click(point!.cx, point!.cy);
        expect(await page.evaluate(ACTIVE_ELEMENT), `${label}: active element after clicking the icon`).toBe(`${controlTag}#${controlId}`);

        // A native select answers a click with its option popup; close it so it
        // cannot swallow the next measurement.
        if (controlTag === "select") await page.keyboard.press("Escape");
      }
    });
  }
}

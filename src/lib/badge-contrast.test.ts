import { describe, expect, it } from "vitest";
import colors from "tailwindcss/colors";
import { USER_ROLES, DEPARTMENTS, DOCUMENT_STATUSES, QUEUE_STATUSES } from "@/lib/constants";
import { EVENT_BADGE_STYLES } from "@/lib/log-event-badge-styles";

/**
 * Issue #153: dark-mode contrast sweep. Colours that ship as class strings are
 * data, so the badge pairs can be checked without a browser: white on every
 * role/department fill, and every coloured text-on-own-fill pair, must clear
 * WCAG AA in both themes. The full sweep that found the original defects is a
 * Playwright audit over 29 page states per theme; this test pins the parts of
 * the fix that live in plain data so they cannot silently regress.
 */

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
/**
 * The app's one custom palette (tailwind.config.ts). It is not part of the
 * `tailwindcss/colors` default export, so the test carries the shades it
 * checks rather than importing the config (which pulls in the plugin graph).
 */
const CUSTOM_COLORS: Record<string, Record<string, string>> = {
  accentBlue: {
    "50": "#f0f7ff",
    "100": "#e0eefe",
    "200": "#bae0fd",
    "300": "#7cc4fc",
    "400": "#38a7fa",
    "500": "#0e8beb",
    "600": "#1f6dd2",
    "700": "#0c4fa3",
    "800": "#0f4486",
    "900": "#133a70",
    "950": "#0d254c",
  },
};

function paletteHex(name: string, shade: string, className: string): string {
  const hex = CUSTOM_COLORS[name]?.[shade] ?? (colors as unknown as Record<string, Record<string, string>>)[name]?.[shade];
  if (!hex) throw new Error(`unknown Tailwind colour "${name}-${shade}" in "${className}"`);
  return hex;
}
/** The page background each theme composites translucent fills onto. */
const THEME_BACKGROUND: Record<"light" | "dark", Rgb> = {
  light: [247, 239, 228],
  dark: [2, 8, 23],
};

/** WCAG 2.x relative luminance of an sRGB triple. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function parseHex(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return top.map((v, i) => Math.round(v * alpha + bottom[i] * (1 - alpha))) as Rgb;
}

/**
 * Resolve one `bg-emerald-900/30` style token to the colour a reader actually
 * sees: the fill composited onto that theme's page background.
 */
function resolveToken(prefix: "bg" | "text", className: string, theme: "light" | "dark"): Rgb | null {
  const pattern =
    theme === "dark" ? new RegExp(`(?:^|[\\s"])dark:${prefix}-([a-zA-Z]+)-(\\d{2,3})(?:/(\\d{2,3}))?`) : new RegExp(`(?:^|[\\s"])${prefix}-([a-zA-Z]+)-(\\d{2,3})(?:/(\\d{2,3}))?`);
  const match = className.match(pattern);
  const effective = match ?? (theme === "dark" ? className.match(new RegExp(`(?:^|[\\s"])${prefix}-([a-zA-Z]+)-(\\d{2,3})(?:/(\\d{2,3}))?`)) : null);
  if (!effective) return null;
  const [, name, shade, alphaToken] = effective;
  const hex = paletteHex(name, shade, className);
  const alpha = alphaToken ? Number(`0.${alphaToken}`) : 1;
  return over(parseHex(hex), alpha, THEME_BACKGROUND[theme]);
}

/** Every colour token of one kind in a class string, e.g. all `text-*`. */
function allTokens(prefix: "text", className: string, theme: "light" | "dark"): Rgb[] {
  const source = className;
  const found: Rgb[] = [];
  const pattern =
    theme === "dark" ? /(?:^|[\s"])dark:text-([a-zA-Z]+)-(\d{2,3})(?:\/(\d{2,3}))?/g : /(?:^|[\s"])text-([a-zA-Z]+)-(\d{2,3})(?:\/(\d{2,3}))?/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, shade, alphaToken] = match;
    const hex = paletteHex(name, shade, className);
    const alpha = alphaToken ? Number(`0.${alphaToken}`) : 1;
    found.push(over(parseHex(hex), alpha, THEME_BACKGROUND[theme]));
  }
  return found;
}

const pairs: Array<[string, string]> = [
  ...Object.entries(USER_ROLES).map(([key, info]): [string, string] => [`USER_ROLES.${key}`, info.color]),
  ...Object.entries(DEPARTMENTS).map(([key, info]): [string, string] => [`DEPARTMENTS.${key}`, info.color]),
  ...Object.entries(DOCUMENT_STATUSES).map(([key, info]): [string, string] => [`DOCUMENT_STATUSES.${key}`, info.color]),
  ...Object.entries(QUEUE_STATUSES).map(([key, info]): [string, string] => [`QUEUE_STATUSES.${key}`, info.color]),
  ...Object.entries(EVENT_BADGE_STYLES).map(([key, info]): [string, string] => [`LogEventBadge.${key}`, info.classes]),
];

describe.each(pairs)("%s", (label, className) => {
  it.each(["light", "dark"] as const)("clears AA against its own fill in %s mode", (theme) => {
    const fill = resolveToken("bg", className, theme);
    if (!fill) throw new Error(`no ${theme} fill in "${className}"`);

    // A `dark:` text colour replaces the light one; without it the same text
    // colour is used in both themes.
    const darkTexts = allTokens("text", className, "dark");
    const texts =
      theme === "dark" && darkTexts.length > 0 ? darkTexts : allTokens("text", className, "light");

    if (texts.length === 0) {
      // White-on-fill pairs, checked separately below.
      expect(contrast(WHITE, fill)).toBeGreaterThanOrEqual(4.5);
      return;
    }
    for (const text of texts) {
      expect(contrast(text, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

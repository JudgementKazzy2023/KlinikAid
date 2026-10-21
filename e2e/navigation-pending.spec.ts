import crypto from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * Issue #182: a repeat visit to an already-visited dashboard route showed no
 * pending feedback at all. The page stayed frozen for about a second while
 * the RSC request ran, and only the sidebar's active item moved.
 *
 * The dashboard needs a signed-in administrator, and the CI browser checks run
 * anonymously, so this spec only runs when the environment provides a
 * throwaway admin account:
 *
 *   KLINIKAID_E2E_ADMIN_EMAIL       the account's address
 *   KLINIKAID_E2E_ADMIN_PASSWORD    its password
 *   KLINIKAID_E2E_ADMIN_TOTP_SECRET its TOTP secret (staff roles are MFA-gated)
 *
 * The account is a throwaway: the verify-and-report skill's e2e-account.mjs
 * creates and deletes them. Without the three variables the spec is skipped,
 * not failed.
 */

const EMAIL = process.env.KLINIKAID_E2E_ADMIN_EMAIL;
const PASSWORD = process.env.KLINIKAID_E2E_ADMIN_PASSWORD;
const SECRET = process.env.KLINIKAID_E2E_ADMIN_TOTP_SECRET;
const signedIn = Boolean(EMAIL && PASSWORD && SECRET);

function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/[\s=]/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error("not a base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1] & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, "0");
}

/** A one-time code in a window that has not been used yet. */
async function freshCode(secret: string): Promise<string> {
  const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsLeft < 8) {
    await new Promise((resolve) => setTimeout(resolve, (secondsLeft + 1) * 1000));
  }
  return totp(secret);
}

test.describe("the pending indicator on a dashboard navigation", () => {
  test.skip(!signedIn, "no throwaway admin account in the environment");

  test("every sidebar navigation shows one, first visit and repeat visit alike", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.fill("#email", EMAIL!);
    await page.fill("#password", PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForSelector("#totpCode");
    await page.fill("#totpCode", await freshCode(SECRET!));
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/dashboard/);
    await page.waitForSelector("aside nav a");

    /**
     * Click a sidebar link and measure the pending indicator.
     *
     * Three moments matter, and they are not the same moment. The mutation
     * observer records when the indicator is put on the page -- that is the
     * click raising it. The animation-frame loop records when it was on
     * screen, which is the frame after the paint. The removal is recorded
     * when the new content has taken its place.
     *
     * A navigation that resolves from the router's cache is over before the
     * browser paints, and there is nothing to indicate in that case: the
     * indicator is put on the page and taken off it again within the same
     * task. The assertions below say so explicitly rather than pretending
     * every navigation is slow.
     */
    const clickAndMeasure = (label: string, path: string) =>
      page.evaluate(
        async ({ text, target }) => {
          const anchor = Array.from(
            document.querySelectorAll<HTMLAnchorElement>("aside nav a")
          ).find((element) => element.textContent?.trim() === text);
          if (!anchor) throw new Error(`no sidebar link labelled ${text}`);

          const visible = (element: Element | null) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
          const indicator = () => {
            const bar = document.querySelector('[data-testid="navigation-progress"]');
            const spinner = document.querySelector('[data-testid="sidebar-link-pending"]');
            return {
              bar: visible(bar),
              spinner: visible(spinner),
              busyLink:
                document.querySelector("aside nav a[aria-busy='true']")?.textContent?.trim() ?? null,
              status:
                document
                  .querySelector("[data-testid='navigation-status']")
                  ?.textContent?.trim() ?? "",
            };
          };

          const state = {
            insertedAt: null as number | null,
            removedAt: null as number | null,
            paintedAt: null as number | null,
            painted: null as ReturnType<typeof indicator> | null,
          };

          const observer = new MutationObserver(() => {
            const { bar, spinner } = indicator();
            if ((bar || spinner) && state.insertedAt === null) {
              state.insertedAt = performance.now();
            } else if (
              !bar &&
              !spinner &&
              state.insertedAt !== null &&
              state.removedAt === null
            ) {
              state.removedAt = performance.now();
            }
          });
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "aria-busy"],
          });

          const start = performance.now();
          anchor.click();

          // Sample the indicator on every frame until the navigation has
          // landed and the indicator has been taken off the page again.
          await new Promise<void>((resolve) => {
            const deadline = start + 10000;
            let landedAt: number | null = null;
            const tick = () => {
              const now = performance.now();
              if (state.paintedAt === null) {
                const { bar, spinner } = indicator();
                if (bar || spinner) {
                  state.paintedAt = now;
                  state.painted = indicator();
                }
              }
              if (landedAt === null && window.location.pathname === target) {
                landedAt = now;
              }
              const settled = landedAt !== null && state.removedAt !== null;
              if (settled || now > deadline) {
                resolve();
                return;
              }
              requestAnimationFrame(tick);
            };
            tick();
          });
          observer.disconnect();

          return { start, ...state };
        },
        { text: label, target: path }
      );

    /** The indicator was on screen for long enough to have been painted. */
    const wasPainted = (result: { insertedAt: number | null; removedAt: number | null; paintedAt: number | null }) =>
      result.paintedAt !== null ||
      (result.insertedAt !== null &&
        result.removedAt !== null &&
        result.removedAt - result.insertedAt > 50);

    // The repro from the issue: /admin/staff -> Role Management ->
    // Staff Management -> Role Management again. The last one is the repeat
    // visit, the navigation that used to show nothing at all.
    await page.locator('aside nav a:has-text("Staff Management")').first().click();
    await page.waitForURL(/\/admin\/staff$/);

    const first = await clickAndMeasure("Role Management", "/admin/roles");
    await page.waitForURL(/\/admin\/roles$/);
    expect(first.insertedAt, "the indicator was raised").not.toBeNull();
    expect(first.insertedAt! - first.start, "ms from the click to the indicator").toBeLessThan(
      100
    );
    expect(wasPainted(first), "the indicator was on screen").toBe(true);
    if (first.painted) {
      expect(first.painted.bar, "the top bar is up").toBe(true);
      expect(first.painted.spinner, "the clicked link shows a spinner").toBe(true);
      expect(first.painted.busyLink, "the clicked link is busy").toContain("Role Management");
      expect(first.painted.status, "the navigation is announced once").not.toBe("");
    }

    await page.locator('aside nav a:has-text("Staff Management")').first().click();
    await page.waitForURL(/\/admin\/staff$/);

    const repeat = await clickAndMeasure("Role Management", "/admin/roles");
    await page.waitForURL(/\/admin\/roles$/);
    expect(repeat.insertedAt, "the indicator was raised on the repeat visit").not.toBeNull();
    expect(
      repeat.insertedAt! - repeat.start,
      "ms from the click to the indicator on the repeat visit"
    ).toBeLessThan(100);
    expect(wasPainted(repeat), "the indicator was on screen on the repeat visit").toBe(true);
    if (repeat.painted) {
      expect(repeat.painted.bar, "the top bar is up on the repeat visit").toBe(true);
      expect(
        repeat.painted.spinner,
        "the clicked link shows a spinner on the repeat visit"
      ).toBe(true);
      expect(repeat.painted.busyLink, "the clicked link is busy on the repeat visit").toContain(
        "Role Management"
      );
    }

    // The indicator goes away with the new content.
    await expect(page.getByTestId("navigation-progress")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-link-pending")).toHaveCount(0);
    await expect(page.locator("aside nav a[aria-busy='true']")).toHaveCount(0);
    await expect(page.getByTestId("navigation-status")).toHaveText("");
  });
});

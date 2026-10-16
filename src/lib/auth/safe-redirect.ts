/**
 * Turns the `?redirect=` value on /login into a path on this site, or null.
 *
 * The value arrives from the URL, so anyone can write it. Only a same-origin
 * path is honoured: `https://…`, protocol-relative `//…`, and `/\…` (which
 * browsers treat as `//`) are all refused, as are their percent-encoded forms.
 * A null result means "use the role's default landing page".
 */
const BASE = "http://klinikaid.invalid";

export function safeRedirectPath(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }

  for (const candidate of [raw, decoded]) {
    if (!candidate.startsWith("/")) return null;
    if (candidate.startsWith("//")) return null;
    if (candidate.includes("\\")) return null;
    // Tabs and newlines are stripped by the URL parser, so `/\t/evil` becomes `//evil`.
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return null;
  }

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

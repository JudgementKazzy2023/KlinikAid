/**
 * Parsing and validation for `GET /api/admin/logs/system`.
 *
 * Kept free of Supabase and Next imports so the rules can be unit-tested and so
 * the client can check the date range with the same rule the server enforces.
 *
 * Every parameter used to reach PostgREST unchecked: `page=-5` produced a
 * negative `range()` and a 500, `page=abc` produced `NaN` and an empty page,
 * `startDate=garbage` became a Postgres cast error and a 500, and `limit` had no
 * ceiling (#65). A malformed parameter is the caller's mistake, so it is now a
 * 400 that names the parameter -- not a server fault, and not an empty result.
 */

export const DEFAULT_PAGE_SIZE = 20;
/** Largest page the list view may request; larger values are clamped to this. */
export const MAX_PAGE_SIZE = 100;
/** Largest CSV export, in rows. Anything beyond is reported as truncated. */
export const MAX_EXPORT_ROWS = 10_000;
export const MAX_SEARCH_LENGTH = 200;

export interface SystemLogQuery {
  page: number;
  limit: number;
  eventType: string | null;
  userId: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Case-insensitive substring of `description`. */
  search: string | null;
  download: boolean;
}

export type ParsedSystemLogQuery =
  | { ok: true; query: SystemLogQuery }
  | { ok: false; error: string };

const POSITIVE_INT = /^[1-9]\d*$/;
// A calendar date, optionally followed by a time. `Date.parse` alone accepts
// strings like "1" (read as the year 2001), so the shape is checked first.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDate(raw: string): string | null {
  if (!ISO_DATE.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** True when both bounds are present and the start falls after the end. */
export function isInvertedRange(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  return Date.parse(start) > Date.parse(end);
}

export function parseSystemLogQuery(params: URLSearchParams): ParsedSystemLogQuery {
  const rawPage = params.get("page");
  let page = 1;
  if (rawPage !== null) {
    if (!POSITIVE_INT.test(rawPage)) {
      return { ok: false, error: "page must be a positive integer." };
    }
    page = Number(rawPage);
  }

  const rawLimit = params.get("limit");
  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== null) {
    if (!POSITIVE_INT.test(rawLimit)) {
      return { ok: false, error: `limit must be an integer from 1 to ${MAX_PAGE_SIZE}.` };
    }
    limit = Math.min(Number(rawLimit), MAX_PAGE_SIZE);
  }

  // The row offset must stay a safe integer for PostgREST's range header.
  if (!Number.isSafeInteger((page - 1) * limit + limit)) {
    return { ok: false, error: "page is out of range." };
  }

  let startDate: string | null = null;
  const rawStart = params.get("startDate");
  if (rawStart) {
    startDate = parseDate(rawStart);
    if (!startDate) return { ok: false, error: "startDate must be an ISO 8601 date." };
  }

  let endDate: string | null = null;
  const rawEnd = params.get("endDate");
  if (rawEnd) {
    endDate = parseDate(rawEnd);
    if (!endDate) return { ok: false, error: "endDate must be an ISO 8601 date." };
  }

  if (isInvertedRange(startDate, endDate)) {
    return { ok: false, error: "startDate is after endDate." };
  }

  const userId = params.get("userId") || null;
  if (userId && !UUID.test(userId)) {
    return { ok: false, error: "userId must be a UUID." };
  }

  const search = params.get("search")?.trim() || null;
  if (search && search.length > MAX_SEARCH_LENGTH) {
    return { ok: false, error: `search must be at most ${MAX_SEARCH_LENGTH} characters.` };
  }

  return {
    ok: true,
    query: {
      page,
      limit,
      eventType: params.get("eventType") || null,
      userId,
      startDate,
      endDate,
      search,
      download: params.get("download") === "true",
    },
  };
}

/**
 * Builds an ILIKE pattern that matches `term` literally anywhere in the column.
 * `%` and `_` are LIKE wildcards and `\` is the escape character, so a search for
 * "100%" must not match every row containing "100".
 *
 * PostgREST also reads `*` in a like pattern as `%`, so a literal asterisk in
 * the search term widens the match rather than narrowing it. That can only
 * return extra rows, never hide one, so it is left as is.
 */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

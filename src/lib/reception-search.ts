/**
 * Helpers for the reception-board document search.
 *
 * The search box on the reception board filters the *whole* documents table on
 * the server, not the capped page the board already loaded. Two grammars read
 * the user's term, so two different sets of characters have to be neutralised
 * before the term reaches the database:
 *
 *  - ILIKE treats `%` and `_` as wildcards and `\` as its escape character. A
 *    bare `%` would match *every* row — the "searched for `%`, got the whole
 *    table" over-match — and a bare `_` would match any one character.
 *  - PostgREST's `or=` grammar treats `,` (condition separator), `(` and `)`
 *    (grouping), `.` (field/operator separator) and `"` (value quoting) as
 *    structural. A term containing any of them would be misparsed as extra
 *    conditions or rejected outright.
 *
 * The two are escaped in-band, one layer at a time:
 *
 *  1. `escapeIlikeLiteral` backslash-escapes `\`, `%`, `_` so Postgres matches
 *     them literally.
 *  2. `quotePostgrestValue` wraps the result in double quotes and escapes `"`
 *     and `\` for PostgREST's quoted-value lexer, so `,`, `(`, `)` and `.` are
 *     treated as value characters rather than grammar.
 *
 * The two backslash-escapes compose: PostgREST's quoted lexer turns each `\\`
 * back into a single `\`, which is exactly the escape Postgres needs to read
 * `%` and `_` as literals. This is verified end-to-end against the live table.
 */

/** Longest search term accepted, in characters after trimming. */
export const MAX_SEARCH_TERM_LENGTH = 100;

/** Maximum documents returned; the caller fetches one extra to detect this bound. */
export const SEARCH_RESULT_LIMIT = 50;

/**
 * Escape the ILIKE metacharacters in a term so they match literally.
 *
 * Backslash is escaped first so that a backslash already in the term is not
 * mistaken for an escape it did not intend.
 */
export function escapeIlikeLiteral(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Quote a value for embedding in a PostgREST filter string.
 *
 * Inside double quotes PostgREST treats `"` and `\` as escape sequences, so
 * those are escaped; everything else — including the `,`, `(`, `)` and `.`
 * that would otherwise be structural in an `or=` filter — is taken literally.
 */
export function quotePostgrestValue(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * The ILIKE pattern for "the term appears anywhere", escaped for ILIKE and
 * quoted for PostgREST. Ready to embed as `column.ilike.${buildSearchPattern(term)}`.
 */
export function buildSearchPattern(term: string): string {
  return quotePostgrestValue("%" + escapeIlikeLiteral(term) + "%");
}

/**
 * PostgREST `or` conditions matching a patient's "first last" name the way the
 * board's local filter did (`"${first} ${last}".includes(term)`): one
 * condition per point where the term's words could split between first_name
 * and last_name, plus each column on its own. Single-word terms only need the
 * per-column conditions.
 */
export function patientNameConditions(term: string): string[] {
  const conditions = [`first_name.ilike.${buildSearchPattern(term)}`, `last_name.ilike.${buildSearchPattern(term)}`];
  const words = term.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length && i <= MAX_NAME_SPLITS; i++) {
    const first = words.slice(0, i).join(" ");
    const last = words.slice(i).join(" ");
    conditions.push(`and(first_name.ilike.${buildSearchPattern(first)},last_name.ilike.${buildSearchPattern(last)})`);
  }
  return conditions;
}

/** Most first/last split points tried for a multi-word term. */
export const MAX_NAME_SPLITS = 6;

import { describe, expect, it } from "vitest";
import {
  buildSearchPattern,
  escapeRegexLiteral,
  patientNameConditions,
  quotePostgrestValue,
} from "./reception-search";

describe("escapeRegexLiteral", () => {
  it("leaves plain text untouched", () => {
    expect(escapeRegexLiteral("abc")).toBe("abc");
  });

  it("escapes the regex metacharacters, including the asterisk", () => {
    expect(escapeRegexLiteral("*")).toBe("\\*");
    expect(escapeRegexLiteral("a*b")).toBe("a\\*b");
    expect(escapeRegexLiteral(".+?^${}()|[]\\")).toBe("\\.\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("leaves % and _ alone; they are literal in a regex, not wildcards", () => {
    expect(escapeRegexLiteral("%")).toBe("%");
    expect(escapeRegexLiteral("_")).toBe("_");
  });

  it("escapes a backslash first, before it can escape something else", () => {
    expect(escapeRegexLiteral("\\")).toBe("\\\\");
  });

  it("never escapes letters, which would turn them into regex classes", () => {
    // `\d`, `\w` and friends are character classes; only punctuation may be
    // escaped or the term would stop matching itself.
    expect(escapeRegexLiteral("dw s")).toBe("dw s");
  });
});

describe("quotePostgrestValue", () => {
  it("wraps a value in double quotes", () => {
    expect(quotePostgrestValue("abc")).toBe('"abc"');
  });

  it("escapes a double quote and a backslash inside the quotes", () => {
    expect(quotePostgrestValue('a"b')).toBe('"a\\"b"');
    expect(quotePostgrestValue("a\\b")).toBe('"a\\\\b"');
  });
});

describe("buildSearchPattern", () => {
  it("produces a quoted, unanchored substring-match pattern", () => {
    expect(buildSearchPattern("abc")).toBe('"abc"');
  });

  it("neutralises PostgREST's * wildcard alias by escaping the asterisk", () => {
    // PostgREST rewrites `*` to `%` in like/ilike values with no escape
    // available. The search uses imatch instead, where `\*` reaches Postgres
    // as a literal asterisk after the quoting layer.
    expect(buildSearchPattern("*")).toBe('"\\\\*"');
    expect(buildSearchPattern("lab*report")).toBe('"lab\\\\*report"');
  });

  it("keeps % and _ literal without escaping them", () => {
    // Not regex metacharacters, so the regex engine already matches them
    // literally — no `%`-wrapping and no escapes.
    expect(buildSearchPattern("%")).toBe('"%"');
    expect(buildSearchPattern("_")).toBe('"_"');
  });

  it("keeps PostgREST structural characters literal by quoting them", () => {
    // `,` would otherwise be parsed as an `or=` condition separator; `(`, `)`
    // and `.` are regex metacharacters on top of that. Inside the double
    // quotes they are value characters.
    expect(buildSearchPattern(",")).toBe('","');
    expect(buildSearchPattern("(")).toBe('"\\\\("');
    expect(buildSearchPattern(")")).toBe('"\\\\)"');
    expect(buildSearchPattern("a,b(c)")).toBe('"a,b\\\\(c\\\\)"');
  });

  it("composes both escape layers for a term with metacharacters and commas", () => {
    // `a,b(c)*` → regex-escaped to `a,b\(c\)\*`, then quoted with each
    // backslash doubled for PostgREST: `"a,b\\(c\\)\\*"`.
    expect(buildSearchPattern("a,b(c)*")).toBe('"a,b\\\\(c\\\\)\\\\*"');
  });

  it("handles an embedded double quote without terminating the value", () => {
    // `"` inside the term is escaped as `\"` so it stays part of the value.
    expect(buildSearchPattern('a"b')).toBe('"a\\"b"');
  });
});

describe("patientNameConditions", () => {
  it("matches each name column for a single word", () => {
    expect(patientNameConditions("Cruz")).toEqual([
      `first_name.imatch.${buildSearchPattern("Cruz")}`,
      `last_name.imatch.${buildSearchPattern("Cruz")}`,
    ]);
  });

  it("adds one first/last split per word boundary for a full name", () => {
    const conditions = patientNameConditions("Juan Dela Cruz");
    expect(conditions).toContain(
      `and(first_name.imatch.${buildSearchPattern("Juan")},last_name.imatch.${buildSearchPattern("Dela Cruz")})`
    );
    expect(conditions).toContain(
      `and(first_name.imatch.${buildSearchPattern("Juan Dela")},last_name.imatch.${buildSearchPattern("Cruz")})`
    );
    expect(conditions).toHaveLength(4);
  });

  it("keeps PostgREST grammar characters inside quoted values", () => {
    for (const condition of patientNameConditions("a,b (c)")) {
      expect(condition).not.toMatch(/imatch\.[^"]/);
    }
  });

  it("never uses like/ilike, where PostgREST would rewrite * to %", () => {
    for (const condition of patientNameConditions("a*b")) {
      expect(condition).not.toMatch(/\.i?like\./);
      expect(condition).toContain(buildSearchPattern("a*b"));
    }
  });
});

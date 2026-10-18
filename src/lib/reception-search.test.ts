import { describe, expect, it } from "vitest";
import {
  buildSearchPattern,
  escapeIlikeLiteral,
  patientNameConditions,
  quotePostgrestValue,
} from "./reception-search";

describe("escapeIlikeLiteral", () => {
  it("leaves plain text untouched", () => {
    expect(escapeIlikeLiteral("abc")).toBe("abc");
  });

  it("escapes the ILIKE wildcards % and _", () => {
    expect(escapeIlikeLiteral("%")).toBe("\\%");
    expect(escapeIlikeLiteral("_")).toBe("\\_");
    expect(escapeIlikeLiteral("a%b_c")).toBe("a\\%b\\_c");
    expect(escapeIlikeLiteral("50% off")).toBe("50\\% off");
  });

  it("escapes a backslash first, before it can escape something else", () => {
    expect(escapeIlikeLiteral("\\")).toBe("\\\\");
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
  it("produces a quoted, case-insensitive contains pattern", () => {
    expect(buildSearchPattern("abc")).toBe('"%abc%"');
  });

  it("neutralises ILIKE wildcards so they match literally", () => {
    // The pattern Postgres receives is `%\%%` — a literal `%` between two
    // wildcards — so `%` cannot turn the search into a match-everything query.
    expect(buildSearchPattern("%")).toBe('"%\\\\%%"');
    expect(buildSearchPattern("_")).toBe('"%\\\\_%"');
  });

  it("keeps PostgREST structural characters literal by quoting them", () => {
    // `,`, `(`, `)` would otherwise be parsed as `or=` grammar. Inside the
    // double quotes they are value characters.
    expect(buildSearchPattern(",")).toBe('"%,%"');
    expect(buildSearchPattern("(")).toBe('"%(%"');
    expect(buildSearchPattern(")")).toBe('"%)%"');
    expect(buildSearchPattern("a,b(c)")).toBe('"%a,b(c)%"');
  });

  it("composes both escape layers for a term with both wildcards and commas", () => {
    // `a,b(c)%` → ILIKE-escaped to `a,b(c)\%`, then quoted with the backslash
    // doubled for PostgREST: `"%a,b(c)\\%%"`.
    expect(buildSearchPattern("a,b(c)%")).toBe('"%a,b(c)\\\\%%"');
  });

  it("handles an embedded double quote without terminating the value", () => {
    // `"` inside the term is escaped as `\"` so it stays part of the value.
    expect(buildSearchPattern('a"b')).toBe('"%a\\"b%"');
  });
});

describe("patientNameConditions", () => {
  it("matches each name column for a single word", () => {
    expect(patientNameConditions("Cruz")).toEqual([
      `first_name.ilike.${buildSearchPattern("Cruz")}`,
      `last_name.ilike.${buildSearchPattern("Cruz")}`,
    ]);
  });

  it("adds one first/last split per word boundary for a full name", () => {
    const conditions = patientNameConditions("Juan Dela Cruz");
    expect(conditions).toContain(
      `and(first_name.ilike.${buildSearchPattern("Juan")},last_name.ilike.${buildSearchPattern("Dela Cruz")})`
    );
    expect(conditions).toContain(
      `and(first_name.ilike.${buildSearchPattern("Juan Dela")},last_name.ilike.${buildSearchPattern("Cruz")})`
    );
    expect(conditions).toHaveLength(4);
  });

  it("keeps PostgREST grammar characters inside quoted values", () => {
    for (const condition of patientNameConditions("a,b (c)")) {
      expect(condition).not.toMatch(/ilike\.[^"]/);
    }
  });
});

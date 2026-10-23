import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLINIC_TEMPLATES } from "@/lib/documentTemplates";

/**
 * The pending-duplicate report (#36) hand-writes the known categories in SQL.
 * A new or renamed template would otherwise show up as "unknown category"
 * there, so this parses the report text (no database) against the catalogue.
 */

const REPORT_SQL = readFileSync(new URL("./pending_document_duplicates.sql", import.meta.url), "utf8");
const EXPECTED = [...CLINIC_TEMPLATES.map((template) => template.id), "other"].sort();

describe("pending_document_duplicates report", () => {
  it("lists exactly the catalogue's template ids plus 'other' as known categories", () => {
    const lists = [...REPORT_SQL.matchAll(/in \(([^)]*'other'[^)]*)\)/g)].map((match) =>
      [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]).sort()
    );
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) expect(list).toEqual(EXPECTED);
  });

  it("opens every part read only and never commits", () => {
    const active = REPORT_SQL.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
    const begins = active.match(/\bbegin\b[^;]*;/gi) ?? [];
    expect(begins.length).toBe(3);
    for (const begin of begins) expect(begin.toLowerCase()).toBe("begin transaction read only;");
    expect(active).not.toMatch(/\b(commit|insert|update|delete|truncate|alter|drop)\b/i);
  });
});

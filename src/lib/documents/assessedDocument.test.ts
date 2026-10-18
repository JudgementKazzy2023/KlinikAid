import { describe, expect, it } from "vitest";
import { finalDocumentPath } from "./assessedDocument";

const USER = "4545a000-0000-4000-8000-000000000001";
const ASSESSMENT = "e3e39e29-e4cb-420b-93e5-75b5e3eedf07";

describe("finalDocumentPath", () => {
  it("is the same for every call with the same assessment", () => {
    expect(finalDocumentPath(USER, ASSESSMENT, "png")).toBe(`${USER}/${ASSESSMENT}.png`);
    expect(finalDocumentPath(USER, ASSESSMENT, "png")).toBe(finalDocumentPath(USER, ASSESSMENT, "png"));
  });

  it("keeps the file inside the user's folder whatever the extension", () => {
    expect(finalDocumentPath(USER, ASSESSMENT, "p/../x")).toBe(`${USER}/${ASSESSMENT}.px`);
    expect(finalDocumentPath(USER, ASSESSMENT, "PDF")).toBe(`${USER}/${ASSESSMENT}.pdf`);
    expect(finalDocumentPath(USER, ASSESSMENT, "j p g")).toBe(`${USER}/${ASSESSMENT}.jpg`);
  });

  it("never produces an empty extension", () => {
    expect(finalDocumentPath(USER, ASSESSMENT, "")).toBe(`${USER}/${ASSESSMENT}.bin`);
    expect(finalDocumentPath(USER, ASSESSMENT, "/..")).toBe(`${USER}/${ASSESSMENT}.bin`);
  });
});

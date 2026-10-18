import { describe, expect, it } from "vitest";
import {
  OPEN_QUEUE_ENTRY_SQLSTATE,
  openQueueEntryDepartment,
  queueNumberFromTriageNotes,
} from "./queue-number";

describe("openQueueEntryDepartment", () => {
  it("returns the department carried in details for the open-entry refusal", () => {
    expect(
      openQueueEntryDepartment({
        code: OPEN_QUEUE_ENTRY_SQLSTATE,
        details: "imaging",
      })
    ).toBe("imaging");
  });

  it("returns an empty string when the refusal carries no department", () => {
    // Still a refusal: the route must answer 409, not fall through to a 500.
    expect(openQueueEntryDepartment({ code: "PT409", details: null })).toBe("");
    expect(openQueueEntryDepartment({ code: "PT409" })).toBe("");
  });

  it("does not treat other errors as the refusal", () => {
    // A raw unique violation is not the open-entry refusal: the function maps the
    // one it expects to PT409, so anything left over is a genuine fault.
    expect(openQueueEntryDepartment({ code: "23505", details: "laboratory" })).toBeNull();
    expect(openQueueEntryDepartment({ code: "42501" })).toBeNull();
    expect(openQueueEntryDepartment(null)).toBeNull();
    expect(openQueueEntryDepartment(undefined)).toBeNull();
  });
});

describe("queueNumberFromTriageNotes", () => {
  it("reads the number from the notes triage_patient() writes", () => {
    // json_build_object's own spacing, as stored by the database.
    const notes =
      '{"queue_number" : "LAB-031", "vitals" : {"weight_kg": 70, "temperature_c": 36.6, "blood_pressure": "120/80"}, "notes" : ""}';
    expect(queueNumberFromTriageNotes(notes)).toBe("LAB-031");
  });

  it("keeps numbers past 999 whole", () => {
    expect(queueNumberFromTriageNotes('{"queue_number":"IMG-1000"}')).toBe("IMG-1000");
  });

  it("returns null when there is no string queue_number", () => {
    expect(queueNumberFromTriageNotes(null)).toBeNull();
    expect(queueNumberFromTriageNotes("")).toBeNull();
    expect(queueNumberFromTriageNotes("free text, not JSON")).toBeNull();
    expect(queueNumberFromTriageNotes('{"notes":"x"}')).toBeNull();
    expect(queueNumberFromTriageNotes('{"queue_number":31}')).toBeNull();
    expect(queueNumberFromTriageNotes("null")).toBeNull();
    expect(queueNumberFromTriageNotes({ queue_number: "LAB-001" })).toBeNull();
  });
});

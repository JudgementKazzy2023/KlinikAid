import { describe, expect, it } from "vitest";
import { isDeclineReply } from "./decline";

describe("isDeclineReply", () => {
  // Replies actually produced by the assistant during #150 verification.
  it("recognises the canonical English decline", () => {
    expect(
      isDeclineReply(
        "I can only assist with clinic inquiries and information related to Bloodcare Medical Laboratory's services, schedules, and policies. I do not have information about selling refurbished laptops. Please contact the reception desk or clinical specialists for specific clinic-related questions."
      )
    ).toBe(true);
  });

  it("recognises the no-prescription decline", () => {
    expect(
      isDeclineReply(
        "I cannot prescribe medication or give medical advice, including antibiotics for a UTI. I can only assist with clinic inquiries. Please contact the reception desk or our clinical specialists for medical assistance."
      )
    ).toBe(true);
  });

  it("recognises Filipino refusals", () => {
    expect(isDeclineReply("Paumanhin, hindi po kami makakatulong sa ganyang kahilingan.")).toBe(true);
    expect(
      isDeclineReply("Maupang mapagkatiwalaan na impormasyon, wala akong impormasyon tungkol dito.")
    ).toBe(true);
  });

  it("recognises a plain refusal without a referral", () => {
    expect(isDeclineReply("I'm sorry, I do not have information about that.")).toBe(true);
    expect(isDeclineReply("I cannot find that in my knowledge.")).toBe(true);
  });

  // The false-positive class the review called out: a substantive answer that
  // happens to mention the referral path must not count as a decline.
  it("does not treat a substantive answer that mentions reception as a decline", () => {
    expect(
      isDeclineReply(
        "Yes, we sell refurbished laptops. Please contact the reception desk to arrange pickup."
      )
    ).toBe(false);
  });

  it("does not treat a substantive answer that contains 'cannot' as a decline", () => {
    expect(
      isDeclineReply(
        "We cannot price that model here, but yes we carry refurbished laptops from 12,000 pesos."
      )
    ).toBe(false);
  });

  it("does not treat a real answer as a decline", () => {
    expect(
      isDeclineReply(
        "Bloodcare Medical Laboratory's operating hours are: Monday-Friday 7:00 AM - 5:00 PM."
      )
    ).toBe(false);
    expect(isDeclineReply("Ang klinika po ay bukas Lunes hanggang Sabado.")).toBe(false);
  });
});

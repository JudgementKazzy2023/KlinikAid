/**
 * Decline detection for out-of-scope chat replies (#150).
 *
 * The live retrieval eval answers its 5 out-of-scope questions with the
 * production system prompt and asserts the reply still declines; this decides
 * "did it decline?" from the reply text. Every alternative is a *refusal
 * phrase* -- the wording `buildSystemPrompt` demands ("you can only assist
 * clinic inquiries") or its Filipino equivalents, plus the negated-information
 * refusals the model actually produces.
 *
 * Deliberately absent: bare negations (`cannot`, `unable`) and bare referral
 * terms (`reception`, `please contact`). A substantive answer can contain those
 * while still answering the question -- "We don't sell laptops, please contact
 * the reception desk for repairs" would otherwise classify as a decline and
 * let the out-of-scope assertion pass on a wrong answer. The false-negative
 * direction is the safe one here: a decline worded in an unrecognised novel way
 * fails the assertion loudly, where a human sees it, instead of passing
 * silently.
 */

const DECLINE_PATTERNS = [
  // Canonical English refusals from the system prompt's decline rule.
  /can (only|not) assist/i,
  /unable to assist/i,
  /cannot (provide|give|offer|answer|help|find|prescribe|diagnose)/i,
  /can'?t (assist|help|provide|give)/i,
  // Negated-information refusals the model produces for unknown topics.
  /(do not|don't) have (that |any )?information/i,
  /no information (about|on)/i,
  /not covered/i,
  // Filipino refusals.
  /paumanhin,? hindi/i,
  /hindi po (ako|kami) makakatulong/i,
  /(wala akong|wala po kaming) (impormasyon|alam|kaalaman)/i,
];

/** True when an out-of-scope reply refuses with a referral instead of answering. */
export function isDeclineReply(reply: string): boolean {
  return DECLINE_PATTERNS.some((pattern) => pattern.test(reply));
}

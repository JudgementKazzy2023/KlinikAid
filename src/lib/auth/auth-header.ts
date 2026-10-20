/**
 * The request header the middleware writes the authenticated user's id into.
 *
 * The middleware asks the Auth server whether the session still exists (the
 * authoritative check, and the step that refreshes the access token). Server
 * code then verifies the access token's signature locally instead of asking
 * the Auth server the same question again (issue #165), and reads this header
 * to bind the two together: the locally verified identity is only accepted
 * when it is the identity the middleware confirmed for this request.
 *
 * A client cannot put a value in it: the middleware deletes the header from
 * the request before writing its own.
 *
 * Kept in its own module because the middleware runs in the edge runtime,
 * where the session module's dependencies are not available.
 */
export const AUTH_USER_HEADER = "x-klinikaid-auth-user";

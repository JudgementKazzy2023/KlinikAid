import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/**
 * The identity behind the current request, verified from the access token's
 * signature (issue #165).
 *
 * Why this exists: `supabase.auth.getUser()` is a network round trip to the
 * Auth server, and the dashboard used to make several of them per navigation
 * (middleware, layout, page helper). This project signs access tokens with an
 * asymmetric key - ES256, published at `<supabase-url>/auth/v1/.well-known/jwks.json`
 * - so the token can be verified locally with `supabase.auth.getClaims()`
 * instead of asking the Auth server who the user is.
 *
 * What this does NOT replace: the middleware still calls `getUser()` once per
 * request. That call is the authoritative check that the session still exists
 * (a signed-out or revoked session is refused there) and the step that
 * refreshes the access token. A request only reaches a server component after
 * that check passed, so the identity read here is the identity the Auth server
 * confirmed moments earlier in the same request.
 *
 * `getClaims()` falls back to asking the Auth server when the token is signed
 * with a symmetric key or when the signing key is unknown, so a change of
 * signing scheme degrades to the previous behaviour instead of failing.
 */

/** A JSON Web Key from the project's key set. */
type SigningKey = {
  kty: string;
  key_ops: string[];
  alg?: string;
  kid?: string;
  [key: string]: unknown;
};

/**
 * How long the fetched key set is reused. The signing keys change rarely;
 * `getClaims()` re-fetches them from the project when it meets a key id it
 * does not know, so a rotation cannot lock anyone out.
 */
const SIGNING_KEY_TTL_MS = 10 * 60 * 1000;

let cachedSigningKeys: SigningKey[] = [];
let cachedSigningKeysAt = 0;
let signingKeysInFlight: Promise<SigningKey[]> | null = null;

async function fetchSigningKeys(): Promise<SigningKey[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase client environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const response = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
    headers: { apikey: anonKey },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Signing key discovery failed with status ${response.status}`);
  }

  const body = (await response.json()) as { keys?: Partial<SigningKey>[] };
  if (!Array.isArray(body.keys)) return [];

  return body.keys.map((key) => ({
    ...key,
    kty: key.kty ?? "oct",
    key_ops: Array.isArray(key.key_ops) ? key.key_ops : [],
  })) as SigningKey[];
}

/**
 * The project's signing keys, fetched once per process and reused.
 *
 * The fetch is a network round trip like the one it replaces, so it is worth
 * doing once rather than per request: a cold start pays for it, every
 * request after that reads the key set from memory.
 */
export async function getSigningKeys(): Promise<SigningKey[]> {
  const now = Date.now();
  if (cachedSigningKeys.length > 0 && now - cachedSigningKeysAt < SIGNING_KEY_TTL_MS) {
    return cachedSigningKeys;
  }

  if (!signingKeysInFlight) {
    signingKeysInFlight = fetchSigningKeys()
      .then((keys) => {
        cachedSigningKeys = keys;
        cachedSigningKeysAt = Date.now();
        return keys;
      })
      .catch((error) => {
        // Keep whatever keys are already known rather than failing the request:
        // `getClaims()` fetches the key set itself when it cannot use ours.
        console.error("Could not fetch the Supabase signing keys:", error);
        return cachedSigningKeys;
      });
  }

  try {
    return await signingKeysInFlight;
  } finally {
    signingKeysInFlight = null;
  }
}

/**
 * The signed-in user of the current request, or null when there is no valid
 * session.
 *
 * `cache()` collapses the calls made by the layout, the page and the auth
 * helpers into one verification per request.
 */
export const getRequestUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createClient();

    // Reads the session from the request cookies. It refreshes the access
    // token when the stored one has expired, which is the same refresh the
    // middleware performs.
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      return null;
    }

    const keys = await getSigningKeys();
    const { data, error } = await supabase.auth.getClaims(sessionData.session.access_token, {
      keys,
    });

    if (error || !data?.claims?.sub) {
      console.error("Could not verify the session token:", error?.message ?? "no subject claim");
      return null;
    }

    const claims = data.claims;
    return {
      id: claims.sub,
      aud: claims.aud ?? "",
      email: claims.email ?? "",
      app_metadata: (claims.app_metadata as Record<string, unknown>) ?? {},
      user_metadata: (claims.user_metadata as Record<string, unknown>) ?? {},
      created_at: claims.iat ? new Date(claims.iat * 1000).toISOString() : new Date().toISOString(),
    } as User;
  } catch (error) {
    console.error("Error in getRequestUser:", error);
    return null;
  }
});

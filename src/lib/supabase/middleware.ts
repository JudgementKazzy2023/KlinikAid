import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Refreshes the user's session on every request, updating the cookies appropriately.
 * Returns the modified response, the Supabase client instance and the session's
 * user.
 *
 * The user is returned from the same call that refreshes the token. The
 * middleware used to make a second `getUser()` call of its own, which meant two
 * round trips to the Auth server on every request for the same answer
 * (issue #165). The call is also the authoritative check that the session
 * still exists: a session that was signed out or revoked is refused here, and
 * the refresh of an expired access token happens as part of it.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase client environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: Do not remove this line. Calling getUser() refreshes the auth token.
  const getUserStarted = Date.now();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (process.env.KLINIKAID_TIMING === "1") {
    console.log(
      `[KTIMING] ${new Date().toISOString()} ${request.headers.get("x-nonce") ?? "no-request"} mw.getUser ${(
        Date.now() - getUserStarted
      ).toFixed(1)}`
    );
  }

  return { supabaseResponse, supabase, user: userError ? null : (user as User | null) };
}

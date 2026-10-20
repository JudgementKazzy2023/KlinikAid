"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, MailCheck, ShieldAlert } from "lucide-react";

type ConfirmState = { kind: "checking" } | { kind: "confirmed" } | { kind: "failed"; message: string };

const EXPIRED_MESSAGE =
  "This confirmation link is invalid or has expired. Sign in to request a new one.";

/**
 * Landing page for the signup confirmation link. Auth's default link confirms the
 * address before redirecting here, with the outcome in the URL fragment; a custom
 * email template may instead pass a token_hash for us to verify.
 */
export default function ConfirmEmailPage() {
  const [state, setState] = useState<ConfirmState>({ kind: "checking" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    // Tokens must not stay in the address bar or the history entry.
    window.history.replaceState(null, "", window.location.pathname);

    const run = async (): Promise<ConfirmState> => {
      const supabase = createClient();

      const linkError = query.get("error_description") || fragment.get("error_description");
      if (linkError || query.get("error") || fragment.get("error")) {
        return { kind: "failed", message: EXPIRED_MESSAGE };
      }

      const tokenHash = query.get("token_hash");
      const type = query.get("type");
      if (tokenHash && (type === "signup" || type === "email")) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error) return { kind: "failed", message: EXPIRED_MESSAGE };
        // Confirmation is the point here; the patient signs in normally afterwards.
        await supabase.auth.signOut({ scope: "local" });
        return { kind: "confirmed" };
      }

      // Ask Auth about the token rather than trusting the fragment's shape.
      const accessToken = fragment.get("access_token");
      if (accessToken) {
        const { data, error } = await supabase.auth.getUser(accessToken);
        if (!error && data.user?.email_confirmed_at) return { kind: "confirmed" };
      }

      return { kind: "failed", message: EXPIRED_MESSAGE };
    };

    run()
      .then(setState)
      .catch(() =>
        setState({ kind: "failed", message: "Your email could not be confirmed right now. Please try again." })
      );
  }, []);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8 overflow-hidden">
      <div className="w-full max-w-md z-10 space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Image src="/icon.png" alt="KlinikAid" width={629} height={645} sizes="64px" className="w-16 rounded-xl mb-2 shadow-lg" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">KlinikAid</h1>
        </div>

        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none bg-white/95 dark:bg-slate-900/95">
          <CardContent className="pt-8 pb-8 flex flex-col items-center space-y-4 text-center">
            {state.kind === "checking" && (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Confirming your email address…</p>
              </>
            )}

            {state.kind === "confirmed" && (
              <>
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950/40">
                  <MailCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Email confirmed</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Your account is active.{" "}
                  <Link href="/login" className="text-accentBlue-600 dark:text-accentBlue-400 hover:underline font-medium">
                    Sign in
                  </Link>{" "}
                  to continue.
                </p>
              </>
            )}

            {state.kind === "failed" && (
              <>
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-100 dark:bg-red-950/40">
                  <ShieldAlert className="h-7 w-7 text-red-600 dark:text-red-400" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Email not confirmed
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{state.message}</p>
                <Link href="/login" className="text-sm text-accentBlue-600 dark:text-accentBlue-400 hover:underline font-medium">
                  Go to sign in
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

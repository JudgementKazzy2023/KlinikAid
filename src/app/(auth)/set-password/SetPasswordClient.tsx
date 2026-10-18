"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { setPasswordAction } from "./actions";
import { logoutAction } from "@/app/(auth)/logout/actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Lock, Loader2, ShieldAlert } from "lucide-react";
import { PASSWORD_REQUIREMENT_TEXT } from "@/lib/validation";

export default function SetPasswordClient({ email }: { email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const data = new FormData();
      data.append("password", password);
      data.append("confirmPassword", confirmPassword);

      try {
        const result = await setPasswordAction(null, data);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.success && result.redirectUrl) {
          router.push(result.redirectUrl);
          router.refresh();
        }
      } catch {
        setError("Failed to set the new password. Please try again.");
      }
    });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8 overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[80px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[80px]" />

      <div className="w-full max-w-md z-10 space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Image src="/icon.png" alt="KlinikAid" width={629} height={645} sizes="64px" className="w-16 rounded-xl mb-2 shadow-lg" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">KlinikAid</h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Bloodcare Medical Laboratory</p>
        </div>

        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none backdrop-blur-sm bg-white/95 dark:bg-slate-900/95">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight text-center">Set Your Password</CardTitle>
            <CardDescription className="text-center text-slate-500 dark:text-slate-400">
              Your account was created at the clinic with a temporary password. Choose your own to continue.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Lets password managers save the new password against the right account. */}
              <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Minimum 8 characters"
                    className="pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isPending}
                    required
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{PASSWORD_REQUIREMENT_TEXT}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-10"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isPending}
                    required
                  />
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col space-y-3">
              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-white font-medium shadow-md shadow-primary/10 transition-all duration-200"
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving password...
                  </>
                ) : (
                  "Set Password & Continue"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-slate-500"
                disabled={isPending}
                onClick={() => startTransition(() => logoutAction())}
              >
                Sign Out
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}

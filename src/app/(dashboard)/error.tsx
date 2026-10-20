"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert, RefreshCw, Home } from "lucide-react";
import { useRouter } from "next/navigation";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    // Log the error securely to the console for tracking
    console.error("Dashboard Layout Error Boundary captured:", error);
  }, [error]);

  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md border-rose-500/20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shadow-2xl transition-all duration-300">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-500 animate-pulse">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Something went wrong
          </CardTitle>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            An unexpected error occurred in this dashboard section.
          </p>
        </CardHeader>

        <CardContent className="space-y-4 pb-4">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-4 border border-slate-100 dark:border-slate-800">
            <p className="text-xs font-mono text-slate-600 dark:text-slate-400 break-words leading-relaxed">
              {error.message || "Unknown Application Error"}
            </p>
            {error.digest && (
              <p className="mt-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                Digest: {error.digest}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button
            onClick={() => reset()}
            className="w-full sm:flex-1 bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 shadow-md hover:shadow-lg flex items-center justify-center gap-2"
          >
            <RefreshCw className="h-4 w-4 animate-spin-reverse" />
            Try Again
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              router.push("/");
              router.refresh();
            }}
            className="w-full sm:flex-1 border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 flex items-center justify-center gap-2"
          >
            <Home className="h-4 w-4" />
            Dashboard
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

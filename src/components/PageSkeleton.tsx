import React from "react";
import { cn } from "@/lib/utils";

/**
 * Placeholder shown while a dashboard route is loading (issue #165).
 *
 * A dashboard navigation used to leave the previous page on screen until the
 * server answered, which read as a frozen application. A route-level
 * `loading.tsx` puts this skeleton on screen as soon as the navigation starts.
 *
 * The colours are the theme's own tokens (`bg-muted`, `bg-border`) so the
 * skeleton follows the light and dark themes without a second set of styles.
 */

type PageSkeletonVariant = "cards" | "table" | "list";

interface PageSkeletonProps {
  variant?: PageSkeletonVariant;
  /** How many placeholder rows or cards to draw. */
  rows?: number;
  /** How many placeholder cards to draw in the `cards` variant. */
  columns?: number;
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-8 w-48 rounded bg-muted" />
      </div>
      <div className="h-10 w-32 rounded bg-muted self-start sm:self-center" />
    </div>
  );
}

function PanelSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <div className={cn("w-full rounded-xl border border-border bg-card", height)} />
  );
}

export default function PageSkeleton({
  variant = "cards",
  rows = 5,
  columns = 4,
}: PageSkeletonProps) {
  return (
    <div className="space-y-6 w-full animate-pulse" aria-hidden="true">
      <HeaderSkeleton />

      {variant === "cards" && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: columns }).map((_, index) => (
              <div
                key={index}
                className="space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm"
              >
                <div className="h-4 w-20 rounded bg-muted" />
                <div className="h-8 w-24 rounded bg-muted" />
                <div className="h-3 w-32 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="h-5 w-40 rounded bg-muted" />
              <PanelSkeleton height="h-56" />
            </div>
            <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="h-5 w-28 rounded bg-muted" />
              <div className="space-y-3">
                {Array.from({ length: rows }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 rounded bg-muted" />
                      <div className="h-3 w-1/2 rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {variant === "table" && (
        <div className="space-y-4 rounded-xl border border-border bg-card shadow-sm">
          <div className="space-y-3 border-b border-border p-4">
            <div className="h-5 w-40 rounded bg-muted" />
            <div className="h-9 w-full max-w-xs rounded bg-muted" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: rows }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 p-4">
                <div className="h-4 w-1/4 rounded bg-muted" />
                <div className="h-4 w-1/4 rounded bg-muted" />
                <div className="h-4 w-1/6 rounded bg-muted" />
                <div className="h-4 w-1/6 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "list" && (
        <div className="space-y-4">
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={index}
              className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="h-5 w-2/5 rounded bg-muted" />
              <div className="h-4 w-4/5 rounded bg-muted" />
              <div className="h-4 w-1/3 rounded bg-muted" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleBlurb, roleLabel, type DbRole } from "@/app/(dashboard)/admin/staff/staff-form";

interface RoleCardsProps {
  roles: DbRole[];
  value: string;
  onChange: (roleId: string) => void;
  invalid?: boolean;
  describedBy?: string;
}

/** Single-choice role picker. Each card says what the role is for, so the choice is not made from a bare name. */
export default function RoleCards({ roles, value, onChange, invalid, describedBy }: RoleCardsProps) {
  return (
    <div role="radiogroup" aria-label="System role" aria-describedby={describedBy} aria-invalid={invalid} className="grid gap-2">
      {roles.map((role) => {
        const selected = role.id === value;
        return (
          <button
            key={role.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(role.id)}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              selected
                ? "border-primary bg-primary/5 shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
                : "border-input bg-white hover:border-slate-400 dark:bg-slate-900 dark:hover:border-slate-600",
              invalid && !selected && "border-rose-300"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
              )}
            >
              {selected && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{roleLabel(role)}</span>
                {!role.is_system && (
                  <span className="rounded border border-slate-200 px-1.5 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">Custom</span>
                )}
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-slate-600 dark:text-slate-400">{roleBlurb(role)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_TITLES, MAX_TITLE_LENGTH } from "@/app/(dashboard)/admin/staff/staff-form";
import { focusRingClass } from "@/lib/focus-ring";

interface TitleChipsProps {
  id: string;
  titles: string[];
  onChange: (titles: string[]) => void;
}

/** Free-text labels as chips: Enter or comma adds, Backspace on an empty field removes the last, each chip has a remove button. */
export default function TitleChips({ id, titles, onChange }: TitleChipsProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = titles.length >= MAX_TITLES;

  const commit = () => {
    const title = draft.trim();
    if (!title) {
      setError(null);
      return;
    }
    if (full) return setError(`Up to ${MAX_TITLES} titles.`);
    if (titles.some((t) => t.toLowerCase() === title.toLowerCase())) return setError("Already listed.");
    onChange([...titles, title]);
    setDraft("");
    setError(null);
  };

  return (
    <div>
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-white px-2 py-1.5 dark:bg-slate-900",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40",
          error && "border-rose-400"
        )}
      >
        {titles.map((title) => (
          <span
            key={title}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 py-0.5 pl-2.5 pr-1 text-[13px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {title}
            <button
              type="button"
              onClick={() => onChange(titles.filter((t) => t !== title))}
              className={`rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-rose-400 ${focusRingClass}`}
              aria-label={`Remove ${title}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={full}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(e) => {
            setDraft(e.target.value.replace(/[|,]/g, ""));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && titles.length) {
              onChange(titles.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={titles.length ? (full ? "" : "Add another") : "e.g. Billing Clerk, then press Enter"}
          className={`min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed ${focusRingClass}`}
          aria-describedby={`${id}-hint`}
        />
      </div>
      <p id={`${id}-hint`} className={cn("mt-1.5 text-xs", error ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400")}>
        {error ?? `Optional labels shown in the registry. They do not change access. ${titles.length}/${MAX_TITLES}`}
      </p>
    </div>
  );
}

import React from "react";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  /** The page's primary action, e.g. "Add Staff". Sits on the right from `sm` up. */
  actions?: React.ReactNode;
}

/**
 * The dashboard page header: title, one-line description and an optional primary
 * action. The description is slate-600 rather than slate-500 because slate-500 on
 * the beige `--background` measures 4.17:1, below the 4.5:1 text minimum (#163).
 */
export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

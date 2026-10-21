import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The shadcn "base-nova" kit is written for Tailwind v4; this repo runs
 * Tailwind v3.4, which rejects an arbitrary variant that has no `&` and so
 * compiled v4's *bare selector* variants (`*:[svg]:…`) to nothing. They are
 * written the v3 way here — `[&>svg]:…` — which selects exactly the elements
 * v4 selects: a direct child of the alert that is an `<svg>` (issue #178).
 *
 * The same applies to the `data-[slot=alert-description]:*:` chain: v3.4
 * applies a variant chain right to left and hangs the pseudo-classes off the
 * *last* node, so the chain has to be written the other way round to style
 * the description element itself (the way `select.tsx` does).
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 [&>svg]:row-span-2 [&>svg]:translate-y-0.5 [&>svg]:text-current [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        // `--destructive` is a *fill* colour (red-500 in light, red-900 in
        // dark). As text it measured 3.44:1 in light and 1.80:1 in dark —
        // the error title was unreadable, and the description kept
        // `text-muted-foreground` because the chain that puts the combinator
        // first never matched. The variant therefore carries its own text
        // colours (rose-700 / rose-300, the pair `DataLoadError` already
        // uses): 5.75:1 in light and 9.53:1 in dark, measured in the
        // browser against the alert's own background (#179).
        destructive:
          "bg-card text-rose-700 dark:text-rose-300 data-[slot=alert-description]:*:text-rose-700/90 dark:data-[slot=alert-description]:*:text-rose-300/90 [&>svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground group-has-[>svg]/alert:col-start-2 md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }

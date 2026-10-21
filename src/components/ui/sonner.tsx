"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Sonner toast host. Reads the resolved theme from next-themes so toasts match
 * the active light/dark choice.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // Sonner's light-theme rich colours are 13px text on a near-white
          // tint, and all four measure below AA (success 4.26:1, info 4.35:1,
          // warning 3.08:1, error 4.35:1 -- issue #153). Same hues, one step
          // darker, each now >= 5:1. The dark-theme values already pass and
          // are deliberately left alone.
          ...(resolvedTheme === "dark"
            ? {}
            : {
                "--success-text": "hsl(140 100% 24%)",
                "--info-text": "hsl(210 92% 34%)",
                "--warning-text": "hsl(31 92% 34%)",
                "--error-text": "hsl(360 100% 34%)",
              }),
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

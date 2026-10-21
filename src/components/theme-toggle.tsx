"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Opt-in theme switch (issue #51). The app is light by default; this flips
 * between light and dark only when the user asks. next-themes does not expose
 * the stored theme until after hydration, so the pre-mount render is a
 * placeholder button of the same shape: rendering the resolved icon immediately
 * would make the server and first client render disagree and warn.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dark mode"
        aria-pressed={false}
        disabled
        className={className}
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  // One ARIA pattern (issue #153): a constant name plus `aria-pressed` for
  // state. A state-dependent name read together with `aria-pressed` produces
  // "Switch to light mode, pressed", which contradicts itself. The placeholder
  // above keeps the same name and reports the not-pressed default it shows.
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Dark mode"
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={className}
    >
      {isDark ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </Button>
  );
}

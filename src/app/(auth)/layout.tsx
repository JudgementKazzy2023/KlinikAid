import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared auth shell (login, register, MFA, password resets). Positions a
 * corner theme toggle so the opt-in theme choice (issue #51) is reachable
 * before sign-in, without repeating it in every page.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle className="bg-background/80 border border-border/60 shadow-sm backdrop-blur-sm hover:bg-muted/80" />
      </div>
      {children}
    </>
  );
}

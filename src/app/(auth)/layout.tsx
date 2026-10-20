import { ThemeToggle } from "@/components/theme-toggle";

// The auth pages (login, register, MFA, password resets) share this corner
// toggle so the opt-in theme choice (issue #51) is reachable before sign-in.
// Positioned in the layout rather than repeated in every page.
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

import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "next-themes";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "KlinikAid",
  description: "Internal clinic management web portal for Bloodcare Medical Laboratory",
};

import { Toaster } from "@/components/ui/sonner";

/**
 * Root layout. Mounts next-themes so every page can follow the user's
 * opt-in theme choice (issue #51).
 *
 * Reads the per-request CSP nonce (issue #154): next-themes injects a
 * pre-paint inline script, and without the nonce on it the policy would block
 * the script and dark mode would flash or fail. Reading a request header makes
 * every page dynamic — the nonce differs per request, so no page can be
 * served from a static prerender.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // Theme is opt-in: light unless the user picks dark, and the OS setting is
    // deliberately not followed (issue #51). next-themes applies the class from
    // its pre-paint inline script, so suppressHydrationWarning absorbs the
    // server/client class difference it causes on <html>.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("min-h-screen bg-background font-sans antialiased", inter.variable)}
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} nonce={nonce}>
          {children}
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}


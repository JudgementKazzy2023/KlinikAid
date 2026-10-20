import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}


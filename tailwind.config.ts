import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // src/lib holds class-string maps (constants.ts role and department badge
    // fills, for one). Without this entry Tailwind never generates those
    // classes, so a badge built from a lib constant renders with no background
    // at all (issue #153).
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // Tailwind v3 ships ring widths 0/1/2/4/8 only; `ring-3` is a Tailwind v4
      // utility. The shadcn "base-nova" ui kit (button, input, select, textarea,
      // switch) declares `focus-visible:ring-3` / `aria-invalid:ring-3`, which
      // silently compiled to nothing here — no ring-width utility means
      // `--tw-ring-shadow` stays at its `0 0 #0000` default and box-shadow is
      // never set, so keyboard focus painted only a 1px border recolor
      // (issue #149). Adding the key makes `.ring-3` a first-class utility with
      // the same ring machinery as `.ring-2`.
      ringWidth: {
        3: "3px",
      },
      // Same story: `aria-invalid:*` is a built-in Tailwind v4 variant, but v3's
      // default theme.aria has no `invalid` entry, so every `aria-invalid:*`
      // class (invalid-state rings/borders in the ui kit) was dead too.
      aria: {
        invalid: 'invalid="true"',
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        accentBlue: {
          50: "#f0f7ff",
          100: "#e0eefe",
          200: "#bae0fd",
          300: "#7cc4fc",
          400: "#38a7fa",
          500: "#0e8beb",
          600: "#1f6dd2",
          700: "#0c4fa3",
          800: "#0f4486",
          900: "#133a70",
          950: "#0d254c",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;

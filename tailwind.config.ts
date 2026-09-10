import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["'Inter Variable'", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono Variable'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
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
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
      },
      borderRadius: {
        "2xl": "calc(var(--radius) + 4px)",
        xl: "calc(var(--radius) + 2px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // Sombras curtas e de baixa opacidade: profundidade sem "flutuar"
        card: "0 1px 1px hsl(var(--shadow-color) / 0.04), 0 1px 3px hsl(var(--shadow-color) / 0.06)",
        "card-hover":
          "0 1px 2px hsl(var(--shadow-color) / 0.06), 0 8px 24px -8px hsl(var(--shadow-color) / 0.18)",
        popover:
          "0 1px 2px hsl(var(--shadow-color) / 0.06), 0 12px 32px -8px hsl(var(--shadow-color) / 0.22)",
        modal:
          "0 2px 4px hsl(var(--shadow-color) / 0.06), 0 24px 64px -16px hsl(var(--shadow-color) / 0.35)",
        "glow-sm": "inset 0 1px 0 hsl(0 0% 100% / 0.16), 0 1px 2px hsl(var(--primary) / 0.30)",
        "glow-md": "inset 0 1px 0 hsl(0 0% 100% / 0.16), 0 4px 14px -2px hsl(var(--primary) / 0.40)",
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
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in-up": "fade-in-up 0.24s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Yatra One"', '"Cormorant Garamond"', "serif"],
        serifd: ['"Cormorant Garamond"', "serif"],
        body: ['"Manrope"', '"Hind"', "system-ui", "sans-serif"],
        deva: ['"Tiro Devanagari Sanskrit"', '"Yatra One"', "serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        ivory: "#FBFBF9",
        cream: "#F3F0E6",
        sand: "#EBE5D8",
        ink: {
          DEFAULT: "#1A1514",
          soft: "#4A423D",
          muted: "#8A817C",
        },
        saffron: {
          DEFAULT: "#F28C28",
          50: "#FEF3E7",
        },
        gold: {
          DEFAULT: "#D4AF37",
          soft: "#C9A227",
          50: "#FBF6E4",
        },
        maroon: {
          DEFAULT: "#722F37",
          deep: "#4E1F26",
        },
        verified: "#2E7D32",
        suspicious: "#D84315",
        revoked: "#B71C1C",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 0px)",
        sm: "calc(var(--radius))",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

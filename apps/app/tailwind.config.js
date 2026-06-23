/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        "paper-2": "var(--paper-2)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        line: "var(--line)",
        // brand + semantic money colors (named to avoid clobbering Tailwind defaults)
        brand: { DEFAULT: "var(--green)", dark: "var(--green-deep)", wash: "var(--green-wash)" },
        credit: { DEFAULT: "var(--green-deep)", wash: "var(--green-wash)" },
        debit: { DEFAULT: "var(--coral)", wash: "var(--coral-wash)" },
        accent: { DEFAULT: "var(--amber)", wash: "var(--amber-wash)" },
      },
      fontFamily: {
        sans: ['"Hanken Grotesk"', "system-ui", '"PingFang SC"', "sans-serif"],
        disp: ['"Space Grotesk"', '"Hanken Grotesk"', "system-ui", "sans-serif"],
      },
      borderRadius: { card: "22px", ctl: "14px" },
      boxShadow: {
        card: "0 1px 2px oklch(0.4 0.03 265 / 0.04), 0 14px 30px -22px oklch(0.4 0.05 265 / 0.5)",
        hero: "0 18px 36px -22px oklch(0.45 0.12 152 / 0.9)",
      },
    },
  },
  plugins: [],
};

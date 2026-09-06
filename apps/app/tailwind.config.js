/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg)",
        surface: "var(--card)",
        ink: "var(--ink)",
        muted: "var(--label2)",
        line: "var(--separator)",
        brand: "var(--blue)",
        credit: "var(--green)",
        debit: "var(--red)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"PingFang SC"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
      },
      borderRadius: { card: "18px", ctl: "12px" },
      boxShadow: { card: "var(--shadow)" },
    },
  },
  plugins: [],
};

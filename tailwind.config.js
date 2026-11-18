/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: { 50: "#eef6ff", 100: "#d9eaff", 500: "#2563eb", 600: "#1d4ed8", 700: "#1e40af" },
        chat: { bg: "#efeae2", out: "#d9fdd3", head: "#1f6f5c" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};

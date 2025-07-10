import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "kas-primary": "#70c7ba",
        "kas-secondary": "#49eacb",
      },
    },
  },
  plugins: [],
} satisfies Config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"] ,
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"]
      },
      colors: {
        ink: "#1b1b1f",
        sand: "#f7f4ee",
        marine: "#251B9F",
        citrus: "#FF491B",
        cream: "#FAF7F0",
        indigo: "#251B9F",
        coral: "#FF491B",
        moss: "#3D7651",
        mint: "#BCEBCB"
      },
      boxShadow: {
        glow: "0 18px 45px -24px rgba(37, 27, 159, 0.45)"
      }
    }
  },
  plugins: []
};

export default config;

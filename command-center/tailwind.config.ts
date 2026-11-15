import type { Config } from "tailwindcss";
import { tokens } from "./lib/design/tokens";

// Loaded from app/globals.css via `@config`. All visual values come from lib/design/tokens.ts.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { ...tokens.colors },
      fontFamily: { sans: [tokens.fonts.sans], mono: [tokens.fonts.mono] },
      spacing: { ...tokens.spacing },
      borderRadius: { ...tokens.radii },
    },
  },
};
export default config;

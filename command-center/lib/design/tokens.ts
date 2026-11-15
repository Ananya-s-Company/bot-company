// Single source of truth for colors, fonts, spacing and radii. Wired into Tailwind via
// tailwind.config.ts. Neutral placeholders; UIUXBot will supply the brand later.
export const tokens = {
  colors: {
    canvas: "#f6f7f9",
    surface: "#ffffff",
    line: "#e2e5ea",
    ink: "#1b1f27",
    subtle: "#5b6472",
    primary: "#2f5fd0",
    "primary-ink": "#ffffff",
    "primary-soft": "#e8eefc",
    danger: "#b42318",
    "risk-green": "#146c43",
    "risk-green-soft": "#e3f4ea",
    "risk-amber": "#8a5a00",
    "risk-amber-soft": "#fdf1d6",
    "risk-red": "#b42318",
    "risk-red-soft": "#fde8e6",
    "risk-pending": "#5b6472",
    "risk-pending-soft": "#eef0f3",
  },
  fonts: {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  spacing: {
    gutter: "1rem",
    card: "0.875rem",
    section: "1.5rem",
  },
  radii: {
    card: "0.625rem",
    badge: "9999px",
    control: "0.5rem",
  },
} as const;

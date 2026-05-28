import type { Config } from 'tailwindcss';

/**
 * openx_core — design tokens for the encrypted-agent marketplace.
 *
 * Single source of truth. Dark-mode only by design: privacy-first
 * products read better on a dark surface and the indigo "encrypted"
 * accent reads cleanly against #131317.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: '#131317',
        surface: '#201f23',
        'surface-container-low': '#1b1b1f',
        'surface-container-high': '#2a292d',
        primary: '#c0c1ff',
        'primary-container': '#c0c1ff',
        'on-primary': '#292b5e',
        secondary: '#4edea3',
        tertiary: '#ffb95f',
        error: '#ffb4ab',
        'on-surface': '#e5e1e7',
        'on-surface-variant': '#c7c5d0',
        outline: '#918f9a',
        'outline-variant': '#46464f',
      },
      fontFamily: {
        headline: ['Geist', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        'glow-indigo': '0 0 24px rgba(192, 193, 255, 0.18)',
        'glow-emerald': '0 0 24px rgba(78, 222, 163, 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;

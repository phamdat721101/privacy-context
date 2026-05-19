import type { Config } from 'tailwindcss';
import uiPreset from '@fhe-ai-context/ui/dist/tailwind-preset';

/**
 * Tailwind config for the Next.js frontend.
 *
 * The new design tokens live in `packages/ui` and are imported as a preset
 * so we have a single source of truth. The existing inline tokens are kept
 * for backward-compat with the legacy pixel-art retro screens; they will
 * be removed when those screens are retired post-v1.0.
 */
const config: Config = {
  presets: [uiPreset],
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    // Pull in component classes used by the design system so Tailwind doesn't
    // tree-shake them out when the only references live in node_modules.
    '../ui/dist/**/*.js',
  ],
  theme: {
    extend: {
      // Legacy aliases — keep until the old screens are retired.
      colors: {
        background: '#0c1324',
        surface: '#0F172A',
        'surface-dim': '#0c1324',
        'surface-bright': '#33394c',
        'surface-container': '#191f31',
        'surface-container-low': '#151b2d',
        'surface-container-high': '#23293c',
        'surface-container-highest': '#2e3447',
        'surface-variant': '#2e3447',
        card: '#1E293B',
        primary: '#c0c1ff',
        'primary-container': '#8083ff',
        'on-primary': '#1000a9',
        'on-primary-container': '#0d0096',
        secondary: '#4edea3',
        'secondary-container': '#00a572',
        'on-secondary': '#003824',
        tertiary: '#ffb95f',
        'tertiary-container': '#ca8100',
        error: '#ffb4ab',
        'error-container': '#93000a',
        'on-surface': '#dce1fb',
        'on-surface-variant': '#c7c4d7',
        'on-background': '#dce1fb',
        'text-primary': '#F8FAFC',
        'text-muted': '#64748B',
        outline: '#908fa0',
        'outline-variant': '#464554',
        border: '#334155',
      },
      spacing: {
        'nav-height': '72px',
        'page-margin-mobile': '1rem',
        'page-margin-desktop': '2rem',
        'card-gap': '1rem',
      },
      fontFamily: {
        headline: ['Geist', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Tokens semânticos (definidos em index.css para claro e escuro).
        // Texto escuro no modo claro e branco no modo escuro, com contraste WCAG AA.
        canvas: token('canvas'),
        surface: token('surface'),
        subtle: token('subtle'),
        ink: {
          DEFAULT: token('ink'),
          muted: token('ink-muted'),
        },
        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
        },
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          ink: token('accent-ink'),
          text: token('accent-text'),
        },
        success: token('success'),
        danger: token('danger'),
        info: token('info'),
        warning: token('warning'),
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

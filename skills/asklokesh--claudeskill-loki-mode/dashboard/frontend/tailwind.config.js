/**
 * Tailwind CSS Configuration for Loki Mode Dashboard
 *
 * Unified with dashboard-ui design tokens from loki-unified-styles.js
 * @see dashboard-ui/core/loki-unified-styles.js for source tokens
 */

import { THEMES, SPACING, RADIUS, TYPOGRAPHY, BREAKPOINTS, Z_INDEX } from '../../../dashboard-ui/core/loki-unified-styles.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Loki unified colors - map to CSS custom properties
        loki: {
          // Background layers
          'bg-primary': 'var(--loki-bg-primary)',
          'bg-secondary': 'var(--loki-bg-secondary)',
          'bg-tertiary': 'var(--loki-bg-tertiary)',
          'bg-card': 'var(--loki-bg-card)',
          'bg-hover': 'var(--loki-bg-hover)',
          'bg-active': 'var(--loki-bg-active)',

          // Accent colors
          accent: 'var(--loki-accent)',
          'accent-hover': 'var(--loki-accent-hover)',
          'accent-active': 'var(--loki-accent-active)',
          'accent-light': 'var(--loki-accent-light)',
          'accent-muted': 'var(--loki-accent-muted)',

          // Text hierarchy
          'text-primary': 'var(--loki-text-primary)',
          'text-secondary': 'var(--loki-text-secondary)',
          'text-muted': 'var(--loki-text-muted)',
          'text-disabled': 'var(--loki-text-disabled)',
          'text-inverse': 'var(--loki-text-inverse)',

          // Border colors
          border: 'var(--loki-border)',
          'border-light': 'var(--loki-border-light)',
          'border-focus': 'var(--loki-border-focus)',

          // Status colors
          success: 'var(--loki-success)',
          'success-muted': 'var(--loki-success-muted)',
          warning: 'var(--loki-warning)',
          'warning-muted': 'var(--loki-warning-muted)',
          error: 'var(--loki-error)',
          'error-muted': 'var(--loki-error-muted)',
          info: 'var(--loki-info)',
          'info-muted': 'var(--loki-info-muted)',

          // Model-specific colors
          opus: 'var(--loki-opus)',
          sonnet: 'var(--loki-sonnet)',
          haiku: 'var(--loki-haiku)',
        },

        // Anthropic brand colors (direct values for non-themed usage)
        anthropic: {
          orange: '#d97757',
          'orange-hover': '#c56a4c',
          'orange-light': '#e89a7f',
          charcoal: '#131314',
          'charcoal-light': '#1a1a1b',
          cream: '#faf9f0',
          'cream-dark': '#f5f4eb',
          slate: '#5c5c5c',
          'slate-light': '#8a8a8a',
        },
      },

      fontFamily: {
        sans: TYPOGRAPHY.fontFamily.sans.split(',').map(f => f.trim().replace(/['"]/g, '')),
        mono: TYPOGRAPHY.fontFamily.mono.split(',').map(f => f.trim().replace(/['"]/g, '')),
      },

      spacing: {
        'loki-xs': SPACING.xs,
        'loki-sm': SPACING.sm,
        'loki-md': SPACING.md,
        'loki-lg': SPACING.lg,
        'loki-xl': SPACING.xl,
        'loki-2xl': SPACING['2xl'],
        'loki-3xl': SPACING['3xl'],
      },

      borderRadius: {
        'loki-none': RADIUS.none,
        'loki-sm': RADIUS.sm,
        'loki-md': RADIUS.md,
        'loki-lg': RADIUS.lg,
        'loki-xl': RADIUS.xl,
        'loki-full': RADIUS.full,
      },

      fontSize: {
        'loki-xs': TYPOGRAPHY.fontSize.xs,
        'loki-sm': TYPOGRAPHY.fontSize.sm,
        'loki-base': TYPOGRAPHY.fontSize.base,
        'loki-md': TYPOGRAPHY.fontSize.md,
        'loki-lg': TYPOGRAPHY.fontSize.lg,
        'loki-xl': TYPOGRAPHY.fontSize.xl,
        'loki-2xl': TYPOGRAPHY.fontSize['2xl'],
        'loki-3xl': TYPOGRAPHY.fontSize['3xl'],
      },

      screens: {
        'loki-sm': BREAKPOINTS.sm,
        'loki-md': BREAKPOINTS.md,
        'loki-lg': BREAKPOINTS.lg,
        'loki-xl': BREAKPOINTS.xl,
        'loki-2xl': BREAKPOINTS['2xl'],
      },

      zIndex: {
        'loki-dropdown': Z_INDEX.dropdown,
        'loki-sticky': Z_INDEX.sticky,
        'loki-modal': Z_INDEX.modal,
        'loki-popover': Z_INDEX.popover,
        'loki-tooltip': Z_INDEX.tooltip,
        'loki-toast': Z_INDEX.toast,
      },

      boxShadow: {
        'loki-sm': 'var(--loki-shadow-sm)',
        'loki-md': 'var(--loki-shadow-md)',
        'loki-lg': 'var(--loki-shadow-lg)',
        'loki-focus': 'var(--loki-shadow-focus)',
      },

      transitionDuration: {
        'loki-fast': '100ms',
        'loki-normal': '200ms',
        'loki-slow': '300ms',
      },

      transitionTimingFunction: {
        'loki-default': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'loki-in': 'cubic-bezier(0.4, 0, 1, 1)',
        'loki-out': 'cubic-bezier(0, 0, 0.2, 1)',
        'loki-bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
    },
  },
  plugins: [],
};

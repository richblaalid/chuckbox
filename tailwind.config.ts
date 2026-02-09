import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Primary font - Nunito for headings, body, and UI (brand standard)
        display: ['var(--font-nunito)', 'system-ui', 'sans-serif'],
        // Body font - Nunito for all text (brand standard)
        sans: ['var(--font-nunito)', 'system-ui', 'sans-serif'],
        // Serif for editorial moments
        serif: ['var(--font-source-serif)', 'Georgia', 'serif'],
      },
      colors: {
        // Semantic colors (mapped to CSS variables)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        // Chuckbox Brand Colors - Pine Greens (Brand Guide v3)
        // Exact Pine palette from brand guidelines
        forest: {
          50: '#f0fdf4',    // Lightest pine tint
          100: '#dcfce7',   // Light pine tint
          200: '#bbf7d0',   // Pine tint
          300: '#86efac',   // Light pine
          400: '#6BC492',   // Pine 400
          500: '#52A07E',   // Pine 500 - Primary light
          600: '#3D8B6A',   // Pine 600 - Primary hover
          700: '#2D6A4F',   // Pine 700 - Primary
          800: '#234D3E',   // Pine 800 - Primary dark (brand primary)
          900: '#1B3D30',   // Pine 900 - Deepest pine
          DEFAULT: '#234D3E', // Pine 800 as default
        },
        // Chuckbox Brand Colors - Amber Accent (Brand Guide January 2026)
        // amber-700 (#b45309) is the primary accent color for highlights and decorative
        amber: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          DEFAULT: '#b45309',
        },
        // Chuckbox Brand Colors - Cream backgrounds
        cream: {
          100: '#FFFDF9',
          300: '#FAF3EB',   // Page background
          400: '#F5E6D3',   // Card accents
          DEFAULT: '#FAF3EB',
        },
        stone: {
          50: '#FAFAF9',
          100: '#F5F5F4',
          200: '#E7E5E4',
          300: '#D6D3D1',
          400: '#A8A29E',
          500: '#78716C',
          600: '#57534E',
          700: '#44403C',
          800: '#292524',
          900: '#1C1917',
        },

        // Semantic status colors
        success: {
          DEFAULT: '#059669',
          light: '#D1FAE5',
          dark: '#047857',
        },
        warning: {
          DEFAULT: '#D97706',
          light: '#FEF3C7',
          dark: '#B45309',
        },
        error: {
          DEFAULT: '#DC2626',
          light: '#FEE2E2',
          dark: '#B91C1C',
        },
        info: {
          DEFAULT: '#0284C7',
          light: '#E0F2FE',
          dark: '#0369A1',
        },

        // Change-type semantic colors (for sync, diff, and status indicators)
        'change-create': {
          DEFAULT: '#16A34A',      // green-600
          light: '#DCFCE7',        // green-100
          dark: '#15803D',         // green-700
          foreground: '#15803D',   // green-700 for text on light bg
        },
        'change-update': {
          DEFAULT: '#2563EB',      // blue-600
          light: '#DBEAFE',        // blue-100
          dark: '#1D4ED8',         // blue-700
          foreground: '#1D4ED8',   // blue-700 for text on light bg
        },
        'change-skip': {
          DEFAULT: '#D97706',      // amber-600
          light: '#FEF3C7',        // amber-100
          dark: '#B45309',         // amber-700
          foreground: '#B45309',   // amber-700 for text on light bg
        },
        'change-match': {
          DEFAULT: '#9333EA',      // purple-600
          light: '#F3E8FF',        // purple-100
          dark: '#7E22CE',         // purple-700
          foreground: '#7E22CE',   // purple-700 for text on light bg
        },
        'change-delete': {
          DEFAULT: '#DC2626',      // red-600
          light: '#FEE2E2',        // red-100
          dark: '#B91C1C',         // red-700
          foreground: '#B91C1C',   // red-700 for text on light bg
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        // Elevation system with forest-tinted shadows for brand consistency
        'xs': '0 1px 2px rgba(20, 83, 45, 0.05)',
        'sm': '0 1px 3px rgba(20, 83, 45, 0.08), 0 1px 2px rgba(20, 83, 45, 0.06)',
        'md': '0 4px 6px rgba(20, 83, 45, 0.08), 0 2px 4px rgba(20, 83, 45, 0.06)',
        'lg': '0 10px 15px rgba(20, 83, 45, 0.08), 0 4px 6px rgba(20, 83, 45, 0.05)',
        'xl': '0 20px 25px rgba(20, 83, 45, 0.10), 0 8px 10px rgba(20, 83, 45, 0.04)',
        '2xl': '0 25px 50px rgba(20, 83, 45, 0.15)',
        // Brand-specific accent shadows
        'forest': '0 4px 12px rgba(20, 83, 45, 0.3)',    // green-900
        'amber': '0 4px 12px rgba(180, 83, 9, 0.3)',      // amber-700
        // Amber glow for success/accent states
        'glow': '0 0 20px rgba(180, 83, 9, 0.25)',
        'glow-lg': '0 0 40px rgba(180, 83, 9, 0.3)',
      },
      backgroundImage: {
        // Radial gradient for campfire glow effect
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        // Subtle warm gradients for depth
        'gradient-warm': 'linear-gradient(180deg, hsl(33, 56%, 97%) 0%, hsl(33, 56%, 95%) 100%)',
        'gradient-forest': 'linear-gradient(180deg, hsl(157, 39%, 25%) 0%, hsl(157, 39%, 22%) 100%)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config

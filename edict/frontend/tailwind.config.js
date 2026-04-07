/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Digital Obsidian Pro Max Palette
        obsidian: {
          full: '#050505',
          panel: '#0E0E0E',
          glass: 'rgba(14, 14, 14, 0.65)',
        },
        onyx: {
          light: '#2A2A2A',
          dim: '#1A1A1A',
        },
        neon: {
          cyan: '#00F2FF',
          violet: '#8C5CFF',
          ember: '#FFB800',
          glitch: '#FF0055',
        },
        slate: {
          text: '#E0E0E0',
          muted: '#808080',
          line: '#262626',
        }
      },
      fontFamily: {
        outfit: ['Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'neon-cyan': '0 0 15px -3px rgba(0, 242, 255, 0.3)',
        'neon-violet': '0 0 15px -3px rgba(140, 92, 255, 0.3)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.8)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      }
    },
  },
  plugins: [],
}

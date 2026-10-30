/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#071b2b', 900: '#0a2437', 800: '#113149' },
        electric: '#1769ff',
      },
      boxShadow: { panel: '0 8px 30px rgba(15, 35, 55, .08)' },
    },
  },
  plugins: [],
}

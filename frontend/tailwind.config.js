/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './hooks/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          red:    '#D42020',
          yellow: '#F5C200',
          black:  '#1A1A1A',
          silver: '#8A8A8A',
        },
        erp: {
          sidebar:     '#FFFFFF',
          topbar:      '#FFFFFF',
          bg:          '#F9FAFB',
          border:      '#E5E7EB',
          borderLight: '#F3F4F6',
          active:      '#EEF2FF',
          activeBorder:'#4F46E5',
          activeText:  '#4F46E5',
          text:        '#111827',
          textMuted:   '#6B7280',
          textFaint:   '#9CA3AF',
          blue:        '#2563EB',
        },
      },
      spacing: { 'touch': '44px' },
      borderRadius: { 'card': '8px' },
    },
  },
  plugins: [],
};

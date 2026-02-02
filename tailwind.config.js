import tailwindcssAnimate from "tailwindcss-animate"

export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        finova: {
          primary: '#4285F4',
          accent: '#E8F0FE',
          bg: '#F4F6F8',
          text: '#333333',
          muted: '#777777',
          white: '#FFFFFF',
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
}

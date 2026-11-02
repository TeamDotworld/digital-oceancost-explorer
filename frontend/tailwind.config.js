const path = require('node:path');

module.exports = {
  // Absolute path so Tailwind finds the source files whichever folder Vite is started from
  content: [
    path.join(__dirname, 'src/**/*.{js,jsx,ts,tsx}'),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

// Usado apenas no build do app Android (CSS compilado, sem depender de CDN).
// No index.html o Tailwind roda pelo Play CDN com as mesmas cores.
module.exports = {
  content: ['./index.html'],
  theme: { extend: { colors: { brand: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a' } } } },
};

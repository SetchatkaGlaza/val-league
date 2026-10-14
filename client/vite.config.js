import { defineConfig } from 'vite';

// Одностраничное приложение (SPA): один index.html, страницы переключаются на клиенте.
// Новая страница = файл в src/views + строка в src/routes.js.
export default defineConfig({
  appType: 'spa', // dev и preview отдают index.html на любой адрес (/login, /rules, …)
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
});

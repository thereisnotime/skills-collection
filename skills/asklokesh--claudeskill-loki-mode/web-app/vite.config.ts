import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/lab/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/lab/api': {
        target: 'http://localhost:57375',
        changeOrigin: true,
      },
      '/lab/proxy': {
        target: 'http://localhost:57375',
        changeOrigin: true,
        ws: true,
      },
      '/lab/ws': {
        target: 'ws://localhost:57375',
        ws: true,
      },
    },
  },
})

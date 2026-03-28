import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:57375',
        changeOrigin: true,
      },
      '/proxy': {
        target: 'http://localhost:57375',
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
        target: 'ws://localhost:57375',
        ws: true,
      },
    },
  },
})

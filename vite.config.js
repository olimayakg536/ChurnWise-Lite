import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, /dataset.csv is forwarded to the dataset host (avoids browser CORS limits).
// In production, vercel.json does the same with a rewrite.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/dataset.csv': {
        target: 'https://edvyro.in',
        changeOrigin: true,
        rewrite: () => '/datasets/customer_churn_sample.csv',
      },
    },
  },
})

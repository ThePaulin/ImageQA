import { defineConfig } from 'vite'

const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export default defineConfig({
  base: './',
  server: { headers },
  preview: { headers },
})

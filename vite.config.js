import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// EchoTrail runs entirely client-side: webcam + mic access require HTTPS
// or localhost. `vite dev` serves localhost, which satisfies that by default.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  }
})

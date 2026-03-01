import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves from /<repo-name>/
  // Change 'dansk-pension-simulator' to match your repo name
  base: '/Pension/',
})

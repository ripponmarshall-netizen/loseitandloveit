import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { PENGUIN_WORKOUT } from './src/assets/penguins.js'

// Puts the workout penguin into index.html so it shows while the JS loads.
const splash = () => ({
  name: 'penguin-splash',
  transformIndexHtml: (html) => html.replace('<!--penguin-workout-->', PENGUIN_WORKOUT),
})

// base './' keeps every asset path relative, so the build works at
// https://<user>.github.io/loseitandloveit/ or any other sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), splash()],
  build: { target: 'es2020', chunkSizeWarningLimit: 700 },
})

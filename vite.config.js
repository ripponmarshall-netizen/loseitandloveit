import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { PENGUIN_WORKOUT } from './src/assets/penguins.js'

// Puts the workout penguin into index.html so it shows while the JS loads.
const splash = () => ({
  name: 'penguin-splash',
  transformIndexHtml: (html) => html.replace('<!--penguin-workout-->', PENGUIN_WORKOUT),
})

// Builds sw.js from src/sw.js with the list of built files written into it, so
// the whole app is stored on install and the first launch with no signal
// works. The file changes with every build, which is what makes phones pick
// up a new version.
const serviceWorker = () => ({
  name: 'service-worker',
  apply: 'build',
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `./${f}`)
    const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
      .replace('self.__ASSETS', JSON.stringify(files))
      .replace('self.__BUILD', JSON.stringify(Date.now().toString(36)))
    this.emitFile({ type: 'asset', fileName: 'sw.js', source })
  },
})

// base './' keeps every asset path relative, so the build works at
// https://<user>.github.io/loseitandloveit/ or any other sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), splash(), serviceWorker()],
  build: { target: 'es2020', chunkSizeWarningLimit: 700 },
})

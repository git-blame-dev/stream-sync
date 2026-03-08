import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: __dirname,
  base: '/gui/',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dock: resolve(__dirname, 'src/dock/main.tsx'),
        overlay: resolve(__dirname, 'src/overlay/main.tsx')
      },
      output: {
        entryFileNames: 'assets/[name].js'
      }
    }
  }
})

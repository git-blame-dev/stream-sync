import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: __dirname,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dock: resolve(__dirname, 'dock.html'),
        overlay: resolve(__dirname, 'overlay.html')
      }
    }
  }
})

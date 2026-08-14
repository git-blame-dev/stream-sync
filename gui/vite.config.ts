import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: __dirname,
  base: '/gui/',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        const isIgnoredDependencyDirective = warning.code === 'MODULE_LEVEL_DIRECTIVE'
          && typeof warning.id === 'string'
          && warning.id.split(/[\\/]/).includes('node_modules')
          && /["']use client["']/.test(warning.message)

        if (!isIgnoredDependencyDirective) {
          warn(warning)
        }
      },
      input: {
        dock: resolve(__dirname, 'src/dock/main.tsx'),
        demo: resolve(__dirname, 'src/demo/main.tsx'),
        overlay: resolve(__dirname, 'src/overlay/main.tsx'),
        operator: resolve(__dirname, 'src/operator/main.tsx')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          if (typeof assetInfo.name === 'string' && assetInfo.name.endsWith('.css')) {
            return assetInfo.name === 'operator.css' ? 'assets/operator.css' : 'assets/styles.css'
          }
          return 'assets/[name]-[hash][extname]'
        }
      }
    }
  }
})

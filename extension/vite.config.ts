import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

// Build configuration for a Chrome MV3 extension with a side panel UI.
// - The sidebar is a regular Vite HTML entry (React app).
// - The service worker is bundled as an ES module.
// - The content script is bundled as an IIFE so it can be injected by the
//   background via chrome.scripting.executeScript.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'cazador-postbuild',
      closeBundle() {
        // Move the sidebar HTML to the dist root so the manifest path matches.
        const root = resolve(__dirname, 'dist')
        const fromNested = resolve(root, 'src/sidebar/index.html')
        const toFlat = resolve(root, 'sidebar.html')
        if (existsSync(fromNested)) {
          copyFileSync(fromNested, toFlat)
        }
        // Copy public assets (manifest.json + icons) into dist root.
        const pub = resolve(__dirname, 'public')
        for (const entry of ['manifest.json', 'icons/icon-16.png', 'icons/icon-48.png', 'icons/icon-128.png']) {
          const src = resolve(pub, entry)
          const dst = resolve(root, entry)
          if (existsSync(src)) {
            mkdirSync(resolve(dst, '..'), { recursive: true })
            copyFileSync(src, dst)
          }
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, 'src/sidebar/index.html'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content-extractor': resolve(__dirname, 'src/content/extractor.ts'),
        'hotmart-extractor': resolve(__dirname, 'src/content/hotmart-extractor.ts'),
        'jvzoo-extractor': resolve(__dirname, 'src/content/jvzoo-extractor.ts'),
        'muncheye-extractor': resolve(__dirname, 'src/content/muncheye-extractor.ts'),
        'dropi-interceptor': resolve(__dirname, 'src/content/dropi-interceptor.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'service-worker') return 'service-worker.js'
          if (chunk.name === 'content-extractor') return 'content-extractor.js'
          if (chunk.name === 'hotmart-extractor') return 'hotmart-extractor.js'
          if (chunk.name === 'jvzoo-extractor') return 'jvzoo-extractor.js'
          if (chunk.name === 'muncheye-extractor') return 'muncheye-extractor.js'
          if (chunk.name === 'dropi-interceptor') return 'dropi-interceptor.js'
          return 'assets/[name]-[hash].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})

import { defineConfig } from 'vite'
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Playkiln package build:
 * - Vite bundles the game into dist/
 * - Copies playkiln.manifest.json and ensures the official SDK is present
 * - Production assets are relocatable (relative base)
 */
export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    // Source maps stay out of the publishable package for size and privacy.
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5174,
    strictPort: false,
  },
  plugins: [
    {
      name: 'playkiln-package',
      closeBundle() {
        const root = process.cwd()
        const dist = resolve(root, 'dist')
        mkdirSync(dist, { recursive: true })
        const manifestSrc = resolve(root, 'playkiln.manifest.json')
        if (existsSync(manifestSrc)) {
          cpSync(manifestSrc, resolve(dist, 'playkiln.manifest.json'))
        }
        const pageSrc = resolve(root, 'playkiln.page.md')
        if (existsSync(pageSrc)) {
          cpSync(pageSrc, resolve(dist, 'playkiln.page.md'))
        }
        // Ensure SDK is in dist (public/ already copies it, but be explicit)
        const sdkPublic = resolve(root, 'public', 'playkiln-sdk.js')
        const sdkDist = resolve(dist, 'playkiln-sdk.js')
        if (existsSync(sdkPublic) && !existsSync(sdkDist)) {
          cpSync(sdkPublic, sdkDist)
        }
        // Stamp build time into a tiny marker for debugging (optional)
        writeFileSync(
          resolve(dist, '.playkiln-build'),
          JSON.stringify(
            {
              builtAt: new Date().toISOString(),
              manifest: existsSync(manifestSrc)
                ? JSON.parse(readFileSync(manifestSrc, 'utf8')).id
                : null,
            },
            null,
            2,
          ),
        )
      },
    },
  ],
})

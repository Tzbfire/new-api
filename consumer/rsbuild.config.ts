import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { request } from 'node:http'
import { request as requestTLS } from 'node:https'
import { resolveSiteBrand } from './src/lib/brand'
import { languages, toIntlLocale } from './src/i18n/languages'

const siteBrand = resolveSiteBrand()
const defaultLanguage = languages.some(({ id }) => id === process.env.PUBLIC_DEFAULT_LANGUAGE)
  ? process.env.PUBLIC_DEFAULT_LANGUAGE
  : 'en'
const backend = process.env.NEW_API_BACKEND || 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: './src/main.tsx' },
    define: Object.fromEntries(
      [
        'PUBLIC_SITE_NAME',
        'PUBLIC_SITE_DOMAIN',
        'PUBLIC_SITE_TITLE',
        'PUBLIC_SITE_DESCRIPTION',
        'PUBLIC_SITE_LOGO_URL',
        'PUBLIC_DEFAULT_LANGUAGE',
      ].map((key) => [`process.env.${key}`, JSON.stringify(process.env[key] || '')]),
    ),
  },
  html: {
    template: './index.html',
    title: siteBrand.title,
    templateParameters: { language: toIntlLocale(defaultLanguage) },
    favicon: './public/favicon.svg',
    meta: {
      description: `${siteBrand.description} Powered by New API · QuantumNous.`,
    },
  },
  output: { assetPrefix: '/_factory/', cleanDistPath: true },
  dev: { assetPrefix: '/_factory/' },
  server: {
    host: '127.0.0.1',
    port: 3100,
    base: '/',
    proxy: [
      {
        pathFilter: (path) => /^\/(?:frontend|api|static|assets)(?:\/|$)/.test(path),
        target: backend,
        changeOrigin: false,
      },
      {
        pathFilter: ['/v1', '/pg'],
        target: backend,
        changeOrigin: false,
        timeout: 0,
        proxyTimeout: 0,
      },
      {
        pathFilter: (path) =>
          !path.startsWith('/_factory/') &&
          !path.startsWith('/_rspack/') &&
          path !== '/favicon.svg' &&
          !/^\/rsbuild-(?:hmr|dev-server)(?:\/|$)/.test(path),
        target: backend,
        changeOrigin: false,
        bypass: async (req, res) => {
          const path = (req.url || '/').split('?')[0]
          // Rsbuild evaluates bypass before pathFilter. Keep local build resources
          // and non-page requests out of the selection probe entirely.
          if (
            path.startsWith('/_factory/') ||
            path.startsWith('/_rspack/') ||
            path === '/favicon.svg' ||
            /^\/rsbuild-(?:hmr|dev-server)(?:\/|$)/.test(path)
          )
            return true
          if (!['GET', 'HEAD'].includes(req.method || '') || /\.[^/]+$/.test(path)) return

          try {
            const selectedConsumer = await new Promise<boolean>((resolve) => {
              const headers: Record<string, string> = {}
              if (req.headers.cookie) headers.Cookie = req.headers.cookie
              if (req.headers.host) headers.Host = req.headers.host
              const probe = (backend.startsWith('https:') ? requestTLS : request)(
                `${backend.replace(/\/$/, '')}${req.url || '/'}`,
                {
                  method: 'HEAD',
                  headers,
                  signal: AbortSignal.timeout(3000),
                },
                (selection) => {
                  selection.resume()
                  resolve(
                    selection.statusCode === 200 &&
                      selection.headers['x-factory-frontend'] === 'consumer',
                  )
                },
              )
              probe.on('error', () => resolve(false))
              probe.end()
            })
            // A missing header (including an older backend), redirect, or disabled
            // consumer must preserve the backend response instead of flashing dev UI.
            if (selectedConsumer) {
              res.setHeader('Cache-Control', 'no-store')
              res.setHeader('Vary', 'Cookie')
              res.setHeader('X-Factory-Frontend', 'consumer')
              // Rewrite only the middleware URL; the browser retains its route
              // and query, even when Accept does not enable history fallback.
              return '/index.html'
            }
          } catch {
            // Let the ordinary proxy produce its backend failure response.
          }
        },
        on: {
          error: (_error, _req, res) => {
            if ('writeHead' in res) {
              if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
              }
              res.end('Development backend unavailable.')
            }
          },
        },
      },
    ],
  },
})

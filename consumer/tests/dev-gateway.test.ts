// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRsbuild } from '@rsbuild/core'

describe('consumer development gateway', () => {
  const requests: Array<{ method: string; path: string; cookie?: string; host?: string }> = []
  let backend: Server
  let origin: string
  let directory: string
  let closeDev: () => Promise<void>
  let enabled = true

  beforeAll(async () => {
    backend = createServer((req, res) => {
      const path = req.url || '/'
      requests.push({
        method: req.method!,
        path,
        cookie: req.headers.cookie,
        host: req.headers.host,
      })
      if (
        path.startsWith('/api/') ||
        path.startsWith('/v1/') ||
        path.startsWith('/static/') ||
        path.startsWith('/assets/') ||
        path.startsWith('/frontend/')
      ) {
        res.end(`backend:${path}`)
        return
      }
      if (path === '/app' || path === '/studio') {
        res.writeHead(307, { Location: path === '/app' ? '/' : '/image-studio' })
        res.end()
        return
      }
      if (
        enabled &&
        req.headers.cookie?.includes('factory_frontend=consumer') &&
        path.startsWith('/pricing')
      ) {
        res.writeHead(307, { Location: '/explore?group=vip' })
        res.end()
        return
      }
      if (path === '/old-backend') {
        res.end('legacy without selection header')
        return
      }
      const consumer =
        enabled &&
        (path.startsWith('/app/oauth/') ||
          (req.headers.cookie?.includes('factory_frontend=consumer') &&
            ['/', '/keys', '/wallet', '/plans'].includes(path.split('?')[0])))
      res.setHeader('X-Factory-Frontend', consumer ? 'consumer' : 'legacy')
      res.end(`backend:${consumer ? 'consumer' : 'legacy'}:${path}`)
    })
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve))
    const address = backend.address()
    if (!address || typeof address === 'string') throw new Error('Expected loopback backend')
    vi.stubEnv('NEW_API_BACKEND', `http://127.0.0.1:${address.port}`)
    const { default: config } = await import('../rsbuild.config')
    directory = await mkdtemp(join(tmpdir(), 'consumer-dev-gateway-'))
    await writeFile(join(directory, 'entry.js'), 'console.log("consumer dev fixture")')
    const rsbuild = await createRsbuild({
      cwd: directory,
      config: {
        ...config,
        plugins: [],
        source: { entry: { index: join(directory, 'entry.js') } },
        html: { title: 'Consumer dev fixture' },
        server: { ...config.server, port: 0, printUrls: false },
      },
    })
    const server = await rsbuild.createDevServer()
    const result = await server.listen()
    origin = `http://127.0.0.1:${result.port}`
    closeDev = () => server.close()
  }, 30000)

  afterAll(async () => {
    await closeDev?.()
    await new Promise<void>((resolve) => backend?.close(() => resolve()))
    if (directory) await rm(directory, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it.each(['/', '/keys', '/wallet'])(
    'honors legacy preference on shared page %s before serving HTML',
    async (path) => {
      const response = await fetch(origin + path, {
        headers: { Cookie: 'factory_frontend=legacy' },
      })
      expect(await response.text()).toBe(`backend:legacy:${path}`)
      expect(requests).toContainEqual({
        method: 'HEAD',
        path,
        cookie: 'factory_frontend=legacy',
        host: new URL(origin).host,
      })
    },
  )

  it.each(['', 'factory_frontend=invalid'])(
    'defaults to backend legacy HTML without a valid saved preference (%s)',
    async (cookie) => {
      const response = await fetch(origin + '/', {
        headers: cookie ? { Cookie: cookie } : undefined,
      })
      expect(await response.text()).toBe('backend:legacy:/')
      expect(response.headers.get('set-cookie')).toBeNull()
    },
  )

  it('keeps consumer HTML and assets on the hot development server', async () => {
    const response = await fetch(origin + '/', {
      headers: { Cookie: 'factory_frontend=consumer' },
    })
    const html = await response.text()
    expect(html).toContain('Consumer dev fixture')
    expect(html).not.toContain('backend:consumer')
    const script = html.match(/src="([^"]*\/index\.js)"/)
    expect(script).not.toBeNull()
    const count = requests.length
    const asset = await fetch(new URL(script![1], origin))
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('consumer dev fixture')
    expect(requests).toHaveLength(count)
  })

  it('serves a consumer deep link without requiring an HTML Accept header', async () => {
    const response = await fetch(origin + '/plans?tab=current', {
      headers: { Accept: 'application/json', Cookie: 'factory_frontend=consumer' },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Consumer dev fixture')
    expect(requests).toContainEqual({
      method: 'HEAD',
      path: '/plans?tab=current',
      cookie: 'factory_frontend=consumer',
      host: new URL(origin).host,
    })
  })

  it('does not assign a version preference while forwarding a legacy page', async () => {
    const response = await fetch(origin + '/console/log')
    expect(await response.text()).toBe('backend:legacy:/console/log')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('keeps lazy compilation activation on the development server', async () => {
    const count = requests.length
    const response = await fetch(origin + '/_rspack/lazy/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('\n')
    expect(requests).toHaveLength(count)
  })

  it('respects the backend global disable even without a preference', async () => {
    enabled = false
    try {
      const response = await fetch(origin + '/wallet')
      expect(await response.text()).toBe('backend:legacy:/wallet')
    } finally {
      enabled = true
    }
  })

  it('keeps consumer OAuth callback HTML in consumer even with legacy preference', async () => {
    const response = await fetch(origin + '/app/oauth/github?code=fixture&state=fixture', {
      headers: { Cookie: 'factory_frontend=legacy' },
    })
    expect(await response.text()).toContain('Consumer dev fixture')
    expect(
      requests
        .filter((request) => request.path.includes('code=fixture'))
        .map((request) => request.method),
    ).toEqual(['HEAD'])
  })

  it.each([
    '/api/user/self',
    '/api/oauth/github?code=fixture',
    '/v1/responses',
    '/static/legacy.js',
    '/assets/legacy.css',
    '/frontend/preference.js',
    '/frontend/switch?version=legacy',
  ])('forwards %s directly without probing or serving SPA HTML', async (path) => {
    const count = requests.length
    const response = await fetch(origin + path)
    expect(await response.text()).toBe(`backend:${path}`)
    expect(requests.slice(count).map((request) => request.method)).toEqual(['GET'])
  })

  it.each([
    ['/app', '/'],
    ['/studio', '/image-studio'],
    ['/pricing?group=vip', '/explore?group=vip'],
  ])('preserves backend redirect from %s', async (path, target) => {
    const response = await fetch(origin + path, {
      redirect: 'manual',
      headers: { Cookie: 'factory_frontend=consumer' },
    })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(target)
  })

  it('falls back to backend HTML when its selection contract is unavailable', async () => {
    const response = await fetch(origin + '/old-backend')
    expect(await response.text()).toBe('legacy without selection header')
  })

  it('returns an explicit backend failure instead of consumer HTML when the backend is unreachable', async () => {
    await new Promise<void>((resolve) => backend.close(() => resolve()))
    const response = await fetch(origin + '/keys')
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('Development backend unavailable.')
  })
})

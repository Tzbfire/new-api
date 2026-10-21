import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(resolve(process.cwd(), '../router/frontend-preference.js'), 'utf8')

function bootstrap(options: {
  preference?: string
  available?: boolean
  current?: string
  path?: string
  search?: string
  storage?: Storage
}) {
  const script = document.createElement('script')
  script.dataset.frontend = options.current ?? 'consumer'
  Object.defineProperty(document, 'currentScript', { configurable: true, value: script })
  const replace = vi.fn()
  const browser = {
    location: {
      pathname: options.path ?? '/keys',
      search: options.search ?? '?tab=mine&code=secret&token=secret',
      hash: '#section',
      protocol: 'https:',
      origin: 'https://gateway.test',
      replace,
    },
    factoryShouldUseConsumer: undefined as ((href: string) => boolean) | undefined,
  }
  runInNewContext(
    source.replace(
      '/* factory frontend config */',
      JSON.stringify({
        preference: options.preference ?? '',
        consumerAvailable: options.available ?? true,
        consumerPages: { '/': true, '/keys': true, '/reset': true, '/login': true },
        consumerAliases: {
          '/pricing': '/explore',
          '/console/token': '/keys',
          '/dashboard': '/usage',
          '/sign-in': '/login',
        },
      }),
    ),
    {
      document,
      localStorage: options.storage ?? localStorage,
      window: browser,
      URL,
      URLSearchParams,
    },
  )
  return Object.assign(replace, { shouldUseConsumer: browser.factoryShouldUseConsumer })
}

beforeEach(() => {
  localStorage.clear()
  document.cookie = 'factory_frontend=; Max-Age=0; Path=/'
})

describe('frontend preference bootstrap', () => {
  it('restores a saved legacy choice before a shared consumer page starts', () => {
    localStorage.setItem('factory:frontend', 'legacy')
    const replace = bootstrap({})
    expect(document.cookie).toContain('factory_frontend=legacy')
    expect(replace).toHaveBeenCalledWith('/keys?tab=mine#section')
  })

  it('respects a newer server choice and updates local storage in both directions', () => {
    for (const preference of ['consumer', 'legacy']) {
      localStorage.setItem('factory:frontend', preference === 'consumer' ? 'legacy' : 'consumer')
      const replace = bootstrap({ preference })
      expect(localStorage.getItem('factory:frontend')).toBe(preference)
      expect(replace).not.toHaveBeenCalled()
    }
  })

  it('preserves ordinary bookmark and payment fields while stripping callback credentials', () => {
    localStorage.setItem('factory:frontend', 'legacy')
    const replace = bootstrap({
      search:
        '?keyword=bookmark&request_id=req-1&from=orders&pay=success&batch=batch-1&state=secret&code=secret&token=secret',
    })
    expect(replace).toHaveBeenCalledWith(
      '/keys?keyword=bookmark&request_id=req-1&from=orders&pay=success&batch=batch-1#section',
    )
  })

  it('keeps the saved consumer choice while the server disables or cannot load that frontend', () => {
    localStorage.setItem('factory:frontend', 'consumer')
    const replace = bootstrap({ current: 'legacy', available: false })
    expect(localStorage.getItem('factory:frontend')).toBe('consumer')
    expect(document.cookie).toContain('factory_frontend=consumer')
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not repeat a correction once the server receives the restored cookie', () => {
    localStorage.setItem('factory:frontend', 'legacy')
    expect(bootstrap({})).toHaveBeenCalledTimes(1)
    expect(bootstrap({ preference: 'legacy', current: 'legacy' })).not.toHaveBeenCalled()
  })

  it.each([
    '/reset',
    '/user/reset',
    '/oauth/github',
    '/app/oauth/github',
    '/console/subscription',
    '/subscriptions',
  ])('does not redirect callbacks or management path %s', (path) => {
    localStorage.setItem('factory:frontend', 'consumer')
    expect(bootstrap({ current: 'legacy', path })).not.toHaveBeenCalled()
  })

  it.each(['/pricing', '/pricing/gpt-image-2', '/console/token', '/dashboard'])(
    'restores consumer on the old user bookmark %s',
    (path) => {
      localStorage.setItem('factory:frontend', 'consumer')
      const replace = bootstrap({ current: 'legacy', path })
      expect(replace).toHaveBeenCalledWith(`${path}?tab=mine#section`)
    },
  )

  it('hands legacy SPA user-page navigation back to the gateway without redirecting administration or callbacks', () => {
    const { shouldUseConsumer } = bootstrap({
      current: 'legacy',
      preference: 'consumer',
      path: '/system-settings',
    })
    expect(shouldUseConsumer).toBeTypeOf('function')
    for (const path of [
      '/keys',
      '/pricing',
      '/pricing/gpt',
      '/pricing/' + 'long-model-name'.repeat(30),
      '/pricing/%E6%A8%A1%E5%9E%8B',
      '/console/token',
      '/dashboard',
      '/sign-in?redirect=%2Fkeys',
    ])
      expect(shouldUseConsumer?.(path), path).toBe(true)
    for (const path of [
      '/subscriptions',
      '/console/subscription',
      '/dashboard/users',
      '/system-settings',
      '/oauth/github?code=original',
      '/app/reset',
      '/reset?token=original',
      '/sign-in?redirect=%2Fsystem-settings',
      '/login?redirect=%2Fsystem-settings',
      'https://elsewhere.test/pricing',
    ])
      expect(shouldUseConsumer?.(path), path).toBe(false)
    document.cookie = 'factory_frontend=legacy; Path=/'
    expect(shouldUseConsumer?.('/pricing')).toBe(false)
  })

  it('does not reload a legacy fallback or explicit legacy page on client navigation', () => {
    expect(
      bootstrap({
        current: 'legacy',
        available: false,
        preference: 'consumer',
      }).shouldUseConsumer?.('/pricing'),
    ).toBe(false)
    expect(
      bootstrap({ current: 'legacy', preference: 'legacy' }).shouldUseConsumer?.('/pricing'),
    ).toBe(false)
  })

  it('preserves a safe login destination when restoring a legacy choice and strips nested credentials', () => {
    localStorage.setItem('factory:frontend', 'legacy')
    const replace = bootstrap({
      path: '/login',
      search: '?next=%2Fkeys%3Fgroup%3Dvip%26token%3Dsecret',
    })
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fkeys%3Fgroup%3Dvip#section')
    expect(
      bootstrap({ path: '/login', search: '?next=https%3A%2F%2Fevil.test' }),
    ).toHaveBeenCalledWith('/login#section')
  })

  it('continues rendering when local storage is blocked or contains an invalid preference', () => {
    const blockedStorage = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(bootstrap({ storage: blockedStorage })).not.toHaveBeenCalled()
    localStorage.setItem('factory:frontend', 'https://evil.test')
    expect(bootstrap({})).not.toHaveBeenCalled()
    expect(document.cookie).toBe('')
  })

  it('continues rendering when cookies cannot be persisted', () => {
    localStorage.setItem('factory:frontend', 'legacy')
    const cookie = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {})
    expect(bootstrap({})).not.toHaveBeenCalled()
    cookie.mockRestore()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecurityDialog } from '../security-dialog'
import { acceptAuthBundle, clearAuth } from '@/lib/auth-state'

const i18n = createInstance()
void i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
})
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  acceptAuthBundle({
    access_token: 'synthetic-token',
    token_type: 'Bearer',
    access_expires_at: Math.floor(Date.now() / 1000) + 900,
    user: {
      id: 7,
      username: 'sample',
      role: 1,
      display_name: 'Sample',
      email: '',
      group: 'default',
      quota: 0,
      used_quota: 0,
      request_count: 0,
    },
    session: {
      sid: 'sample-session',
      current: true,
      login_method: 'password',
      ip: '127.0.0.1',
      user_agent: 'Test',
      created_at: 1,
      last_active_at: 2,
      expires_at: 9999999999,
    },
  })
})
afterEach(() => {
  clearAuth()
  vi.unstubAllGlobals()
})

function renderDialog(run: (proof: string) => Promise<void>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SecurityDialog
          action={{ title: 'Enable account security', scope: '2fa.setup', run }}
          onClose={() => undefined}
        />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe('security verification user flow', () => {
  it('requires the server-approved factor and spends the returned proof only once', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const fetcher = vi.fn().mockImplementation(async (path: string, options: RequestInit) => {
      if (path.startsWith('/api/verify/methods'))
        return response({
          success: true,
          data: {
            scope: '2fa.setup',
            methods: [
              { method: '2fa', available: true },
              { method: 'password', available: false },
            ],
            password_encryption_enabled: false,
          },
        })
      expect(path).toBe('/api/verify')
      expect(JSON.parse(String(options.body))).toEqual({
        scope: '2fa.setup',
        method: '2fa',
        code: '123456',
      })
      return response({
        success: true,
        data: {
          proof_token: 'synthetic-one-use-proof',
          expires_at: Math.floor(Date.now() / 1000) + 60,
          method: '2fa',
          scope: '2fa.setup',
        },
      })
    })
    vi.stubGlobal('fetch', fetcher)
    renderDialog(run)
    const input = await screen.findByRole('textbox', { name: 'Verification code' })
    expect(screen.queryByRole('option', { name: 'Password' })).not.toBeInTheDocument()
    expect(run).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.type(input, '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }))
    await waitFor(() => expect(run).toHaveBeenCalledExactlyOnceWith('synthetic-one-use-proof'))
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/verify')).toHaveLength(1)
  })

  it('shows a failed or expired challenge without performing the protected action', async () => {
    const run = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (path: string) => {
        if (path.startsWith('/api/verify/methods'))
          return response({
            success: true,
            data: {
              scope: '2fa.setup',
              methods: [{ method: '2fa', available: true }],
              password_encryption_enabled: false,
            },
          })
        return response({
          success: false,
          code: 'AUTH_FLOW_INVALID',
          message: 'Verification flow expired',
        })
      }),
    )
    renderDialog(run)
    const input = await screen.findByRole('textbox', { name: 'Verification code' })
    const user = userEvent.setup()
    await user.type(input, '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Verification flow expired')
    expect(run).not.toHaveBeenCalled()
  })

  it('offers only the linked provider when the server disallows password verification', async () => {
    const run = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          success: true,
          data: {
            scope: '2fa.setup',
            methods: [{ method: 'oauth', available: true }],
            oauth_providers: [{ slug: 'github', name: 'GitHub' }],
            password_encryption_enabled: false,
          },
        }),
      ),
    )
    renderDialog(run)
    const linkedAccount = await screen.findByRole('combobox', { name: 'Linked account' })
    expect(linkedAccount).toHaveTextContent('GitHub')
    const user = userEvent.setup()
    await user.click(linkedAccount)
    expect(await screen.findByRole('option', { name: 'GitHub' })).toBeVisible()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Verify and continue' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
    expect(run).not.toHaveBeenCalled()
  })
})

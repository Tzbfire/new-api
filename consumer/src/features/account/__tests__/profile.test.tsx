import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '@/lib/api'
import AccountPage from '../index'

vi.mock('@/lib/session', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { username: 'profile-fixture', display_name: 'Example', has_password: true },
    refreshUser: vi.fn(),
  }),
}))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  request: vi.fn(),
  ensureFreshAuthentication: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../email', () => ({ AccountEmail: () => null }))
vi.mock('../security', () => ({ AccountSecurity: () => null }))
vi.mock('../sessions', () => ({ AccountSessions: () => null }))
vi.mock('../connections', () => ({ AccountConnections: () => null }))

beforeEach(() => vi.clearAllMocks())

it('rejects a whitespace-only nickname and saves a corrected trimmed name', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: AccountPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  vi.mocked(request).mockResolvedValue(undefined)
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  const name = await screen.findByRole('textbox', { name: 'What should we call you?' })
  await user.clear(name)
  await user.type(name, '   ')
  await user.click(screen.getByRole('button', { name: 'Save profile' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a name with at least one non-space character.',
  )
  expect(name).toHaveAttribute('aria-invalid', 'true')
  expect(request).not.toHaveBeenCalled()
  expect(screen.queryByText('Profile saved')).not.toBeInTheDocument()
  await user.clear(name)
  await user.type(name, '  Example QA  ')
  await user.click(screen.getByRole('button', { name: 'Save profile' }))
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  expect(request).toHaveBeenCalledWith(
    '/api/user/self',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ username: 'profile-fixture', display_name: 'Example QA' }),
    }),
  )
  expect(await screen.findByText('Profile saved')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  client.clear()
})

it('keeps deletion collapsed and requires identity verification before final confirmation', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: AccountPage }),
    history: createMemoryHistory(),
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.startsWith('/api/verify/methods')) return { methods: [] } as never
    throw new Error('Unexpected write')
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await screen.findByText('Close your account')
  expect(
    screen.queryByRole('textbox', { name: 'Type your username to confirm' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
  await user.click(screen.getByText('Close your account'))
  expect(
    screen.getByText(
      'Identity verification is required. You will review a final confirmation before deletion.',
    ),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Verify your identity' }))
  expect(
    await screen.findByText('No verification method is available. Contact the site administrator.'),
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
  expect(vi.mocked(request).mock.calls.every(([, options]) => options?.method !== 'DELETE')).toBe(
    true,
  )
  client.clear()
})

it('requires a final confirmation after scoped verification and discards proof on cancellation', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: AccountPage }),
    history: createMemoryHistory(),
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.startsWith('/api/verify/methods'))
      return {
        methods: [{ method: 'password', available: true }],
        password_encryption_enabled: false,
      } as never
    if (path === '/api/verify')
      return {
        proof_token: 'synthetic-scoped-proof',
        scope: 'account.delete',
        expires_at: Date.now() / 1000 + 60,
      } as never
    throw new Error('Unexpected write')
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByText('Close your account'))
  await user.click(screen.getByRole('button', { name: 'Verify your identity' }))
  await user.type(
    await within(
      screen.getByRole('dialog', { name: 'Verify before closing your account' }),
    ).findByLabelText('Current password'),
    'synthetic-password',
  )
  await user.click(screen.getByRole('button', { name: 'Verify and continue' }))
  expect(
    await screen.findByText('This is the final step. Your account cannot be recovered.'),
  ).toBeVisible()
  expect(vi.mocked(request).mock.calls.every(([, options]) => options?.method !== 'DELETE')).toBe(
    true,
  )
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled()
  await user.type(
    screen.getByRole('textbox', { name: 'Type your username to confirm' }),
    'profile-fixture',
  )
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(
    screen.queryByRole('textbox', { name: 'Type your username to confirm' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Verify your identity' }))
  expect(
    await within(
      screen.getByRole('dialog', { name: 'Verify before closing your account' }),
    ).findByLabelText('Current password'),
  ).toHaveValue('')
  expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
  client.clear()
})

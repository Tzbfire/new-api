import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import RegisterPage from '../register'
import LoginPage from '../login'
import { SessionProvider } from '@/lib/session'
import { clearAuth } from '@/lib/auth-state'
import zh from '@/i18n/locales/zh.json'

afterEach(() => vi.unstubAllGlobals())

it.each([
  { email: 'invalid-email', sent: false },
  { email: 'person@example.test', sent: true },
])('requests a verification code only when $email is valid', async ({ email, sent }) => {
  const fetcher = vi.fn(async (_path: string) =>
    Response.json({ success: true, data: { email_verification: true } }),
  )
  vi.stubGlobal('fetch', fetcher)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: RegisterPage }),
    history: createMemoryHistory(),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', { name: 'Email' }), email)
  await user.click(screen.getByRole('button', { name: 'Send verification code' }))
  if (sent)
    expect(await screen.findByText('Check your inbox for the verification code.')).toBeVisible()
  else
    expect(
      screen.queryByText('Check your inbox for the verification code.'),
    ).not.toBeInTheDocument()
  expect(
    fetcher.mock.calls.filter(([path]) => String(path).startsWith('/api/verification')),
  ).toHaveLength(sent ? 1 : 0)
})

it('presents a failed sign-in as a translated authentication error while preserving its server reason', async () => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path.startsWith('/api/status')) return Response.json({ success: true, data: {} })
      return Response.json({ success: false, message: 'Invalid parameters' })
    }),
  )
  const i18n = createInstance()
  await i18n.init({ lng: 'zh', resources: { zh } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: LoginPage }),
    history: createMemoryHistory(),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', { name: '用户名' }), 'synthetic-user')
  await user.type(screen.getByLabelText('密码', { exact: true }), 'synthetic-password')
  await user.click(screen.getByRole('button', { name: /^登录$/ }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('登录失败')
  expect(alert).toHaveTextContent('参数无效')
  expect(alert).not.toHaveTextContent('内容加载失败')
  client.clear()
})

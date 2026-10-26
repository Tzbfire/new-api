import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { acceptAuthBundle, clearAuth, getAuthSnapshot } from '@/lib/auth-state'
import { SessionProvider, useSession } from '@/lib/session'
import { CheckinButton, CheckinProvider } from '..'

afterEach(() => {
  vi.useRealTimers()
  clearAuth({ verified: true })
  vi.unstubAllGlobals()
})

async function fixture(options: { enabled?: boolean; captcha?: boolean; checked?: boolean } = {}) {
  let checked = options.checked ?? false
  let quota = 100000
  let failBalance = false
  let failConfirmation = false
  let post: (() => Promise<Response>) | undefined
  const metadata = {
    today: '2026-10-27',
    server_time: 1793095200,
    next_reset_at: 1793116800,
    timezone: 'UTC+08:00',
  }
  const current = () => ({
    ...metadata,
    enabled: true,
    min_quota: 1000,
    max_quota: 1000,
    stats: {
      checked_in_today: checked,
      checkin_count: checked ? 1 : 0,
      total_checkins: checked ? 1 : 0,
      total_quota: checked ? 1000 : 0,
      records: checked ? [{ checkin_date: metadata.today, quota_awarded: 1000 }] : [],
    },
  })
  const user = {
    id: 91,
    username: 'checkin-test',
    display_name: 'Test',
    email: '',
    role: 1,
    group: 'default',
    quota,
    used_quota: 0,
    request_count: 0,
  }
  acceptAuthBundle({
    access_token: 'synthetic-checkin-test',
    token_type: 'Bearer',
    access_expires_at: 9999999999,
    user,
    session: {
      sid: 'checkin-test',
      current: true,
      login_method: 'password',
      ip: '',
      user_agent: '',
      created_at: 1,
      last_active_at: 1,
      expires_at: 9999999999,
    },
  })
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/status')
      return Response.json({
        success: true,
        data: {
          checkin_enabled: options.enabled ?? true,
          turnstile_check: options.captcha ?? false,
          turnstile_site_key: 'synthetic-site-key',
          quota_per_unit: 500000,
          quota_display_type: 'USD',
        },
      })
    if (path === '/api/user/self') {
      if (failBalance) throw new TypeError('Network unavailable')
      return Response.json({ success: true, data: { ...user, quota } })
    }
    if (path.startsWith('/api/user/checkin')) {
      if (init?.method === 'POST') {
        if (post) return post()
        checked = true
        quota += 1000
        return Response.json({
          success: true,
          data: {
            ...metadata,
            quota_awarded: 1000,
            checkin_date: metadata.today,
          },
        })
      }
      if (failConfirmation) throw new TypeError('Network unavailable')
      if (path.includes('month=2026-09'))
        return Response.json({
          success: true,
          data: {
            ...current(),
            stats: { ...current().stats, checkin_count: 0, records: [] },
          },
        })
      return Response.json({ success: true, data: current() })
    }
    throw new Error(`Unexpected test request ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Balance() {
    return <output aria-label="Wallet balance">{useSession().user?.quota}</output>
  }
  const view = render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <CheckinProvider>
            <CheckinButton />
            <CheckinButton />
            <Balance />
          </CheckinProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return {
    ...view,
    client,
    fetcher,
    setPost: (handler: () => Promise<Response>) => {
      post = handler
    },
    failBalance: () => {
      failBalance = true
    },
    failConfirmation: (value: boolean) => {
      failConfirmation = value
    },
    award: () => {
      checked = true
      quota += 1000
    },
    nextDay: () => {
      checked = false
      metadata.today = '2026-10-28'
      metadata.server_time = metadata.next_reset_at
      metadata.next_reset_at += 86400
    },
    metadata,
  }
}

it('hides all entrances and makes no check-in request when disabled', async () => {
  const app = await fixture({ enabled: false })
  await waitFor(() => expect(app.client.getQueryData(['status'])).toBeDefined())
  expect(screen.queryByRole('button', { name: /Check in/ })).not.toBeInTheDocument()
  expect(app.fetcher.mock.calls.some(([path]) => path.includes('/checkin'))).toBe(false)
})

it('claims once from either entrance, shares the busy state, and refreshes the balance', async () => {
  const app = await fixture()
  const buttons = await screen.findAllByRole('button', { name: 'Check in for credit' })
  await waitFor(() => expect(buttons[0]).toBeEnabled())
  let finish!: () => void
  app.setPost(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    app.award()
    return Response.json({
      success: true,
      data: { ...app.metadata, quota_awarded: 1000, checkin_date: app.metadata.today },
    })
  })
  await userEvent.click(buttons[0]!)
  expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => finish())
  expect(await screen.findAllByRole('button', { name: /Claimed \$0\.002/ })).toHaveLength(2)
  expect(screen.getByLabelText('Wallet balance')).toHaveTextContent('101000')
  expect(app.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

it('confirms an ambiguous request before offering another claim', async () => {
  const app = await fixture()
  const buttons = await screen.findAllByRole('button', { name: 'Check in for credit' })
  await waitFor(() => expect(buttons[0]).toBeEnabled())
  app.setPost(async () => {
    throw new TypeError('Connection interrupted')
  })
  app.failConfirmation(true)
  await userEvent.click(buttons[0]!)
  expect(
    await screen.findByText('Unable to confirm check-in. Refresh the status before trying again.'),
  ).toBeVisible()
  expect(
    within(screen.getByRole('dialog')).queryByRole('button', { name: 'Check in for credit' }),
  ).not.toBeInTheDocument()
  app.award()
  app.failConfirmation(false)
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Refresh check-in status' }),
  )
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog')).queryByRole('button', { name: 'Refresh check-in status' }),
    ).not.toBeInTheDocument(),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(await screen.findAllByRole('button', { name: 'Checked in today' })).toHaveLength(2)
  expect(app.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

it('keeps a confirmed award when the separate balance refresh fails', async () => {
  const app = await fixture()
  const buttons = await screen.findAllByRole('button', { name: 'Check in for credit' })
  await waitFor(() => expect(buttons[0]).toBeEnabled())
  app.failBalance()
  await userEvent.click(buttons[0]!)
  expect(await screen.findByText('Check-in successful. Balance is still updating.')).toBeVisible()
  expect(screen.getAllByRole('button', { name: /Claimed/, hidden: true })).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Refresh balance' })).toBeVisible()
  expect(app.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

it('uses existing verification before posting and never retries the POST automatically', async () => {
  const renderVerification = vi.fn((_element: HTMLElement, options: Record<string, unknown>) => {
    queueMicrotask(() => (options.callback as (token: string) => void)('synthetic-verification'))
    return 'widget'
  })
  window.turnstile = { render: renderVerification, remove: vi.fn() }
  const app = await fixture({ captcha: true })
  const buttons = await screen.findAllByRole('button', { name: 'Check in for credit' })
  await waitFor(() => expect(buttons[0]).toBeEnabled())
  await userEvent.click(buttons[0]!)
  expect(await screen.findByRole('dialog', { name: 'Daily check-in' })).toBeVisible()
  expect(app.fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  const verify = await screen.findByRole('button', { name: 'Verify to check in' })
  await waitFor(() => expect(verify).toBeEnabled())
  await userEvent.click(verify)
  expect(await screen.findAllByRole('button', { name: /Claimed/ })).toHaveLength(2)
  expect(app.fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]).toContain(
    'turnstile=synthetic-verification',
  )
  delete window.turnstile
})

it('shows server-day rewards and only fetches a previous month after expanding history', async () => {
  const app = await fixture({ checked: true })
  await userEvent.click((await screen.findAllByRole('button', { name: 'Checked in today' }))[0]!)
  expect(await screen.findByText(/Resets daily at 00:00 \(UTC\+08:00\)/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Check-in records' }))
  expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
  expect(await screen.findByText('No check-ins this month')).toBeVisible()
  expect(app.fetcher.mock.calls.some(([path]) => path.includes('month=2026-09'))).toBe(true)
  expect(app.fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

it('rejects an old claim when the account changes before its request is sent', async () => {
  const app = await fixture()
  const buttons = await screen.findAllByRole('button', { name: 'Check in for credit' })
  await waitFor(() => expect(buttons[0]).toBeEnabled())
  const previous = getAuthSnapshot()
  act(() => {
    fireEvent.click(buttons[0]!)
    acceptAuthBundle({
      access_token: 'synthetic-other-account',
      token_type: 'Bearer',
      access_expires_at: 9999999999,
      user: { ...previous.user!, id: 92 },
      session: { ...previous.session!, sid: 'other-session' },
    })
  })
  await waitFor(() =>
    expect(app.client.getQueryData(['checkin', 92, 'other-session', 'current'])).toBeDefined(),
  )
  expect(app.fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  expect(screen.queryByText(/Check-in successful/)).not.toBeInTheDocument()
})

it('refreshes eligibility at the server midnight even when the device date differs', async () => {
  const app = await fixture({ checked: true })
  await screen.findAllByRole('button', { name: 'Checked in today' })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const key = ['checkin', 91, 'checkin-test', 'current']
  act(() => {
    app.client.setQueryData(key, (data: Record<string, unknown> | undefined) => ({
      ...data,
      server_time: app.metadata.server_time,
      next_reset_at: app.metadata.server_time + 1,
    }))
  })
  app.nextDay()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200)
  })
  vi.useRealTimers()
  expect(await screen.findAllByRole('button', { name: 'Check in for credit' })).toHaveLength(2)
  expect(app.fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

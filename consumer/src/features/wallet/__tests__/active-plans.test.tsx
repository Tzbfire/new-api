import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { acceptAuthBundle, clearAuth } from '@/lib/auth-state'
import { SessionProvider } from '@/lib/session'
import { ActivePlanSummary } from '../ActivePlanSummary'
import type { UserSubscription } from '../api'

afterEach(() => {
  vi.unstubAllGlobals()
  clearAuth()
  localStorage.clear()
})
async function showPlans(
  active: UserSubscription[],
  history: UserSubscription[] = [],
  groups = ['default', 'codeplan'],
) {
  acceptAuthBundle({
    access_token: 'synthetic-active-plan-test',
    token_type: 'Bearer',
    access_expires_at: 9999999999,
    user: {
      id: 21,
      username: 'plan-user',
      display_name: '',
      email: '',
      role: 1,
      group: 'default',
      quota: 0,
      used_quota: 0,
      request_count: 0,
    },
    session: {
      sid: 'active-plan-test',
      current: true,
      login_method: 'password',
      ip: '',
      user_agent: '',
      created_at: 1,
      last_active_at: 1,
      expires_at: 9999999999,
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/status')
        return Response.json({
          success: true,
          data: { quota_per_unit: 500000, quota_display_type: 'USD' },
        })
      if (path === '/api/subscription/plans')
        return Response.json({
          success: true,
          data: [
            { plan: { id: 1, title: 'Code plan' } },
            { plan: { id: 2, title: 'Unlimited plan' } },
          ],
        })
      if (path === '/api/subscription/self')
        return Response.json({
          success: true,
          data: {
            subscriptions: active.map((subscription) => ({ subscription })),
            all_subscriptions: history.map((subscription) => ({ subscription })),
          },
        })
      if (path === '/api/pricing')
        return Response.json({
          success: true,
          data: ['default', 'codeplan'].map((group) => ({
            model_name: `${group}-model`,
            supported_endpoint_types: ['openai'],
            enable_groups: [group],
          })),
          usable_group: { default: 'Default', codeplan: 'Code plan' },
          group_ratio: { default: 1, codeplan: 2 },
        })
      if (path === '/api/user/self/groups')
        return Response.json({
          success: true,
          data: Object.fromEntries(groups.map((group) => [group, { desc: group, ratio: 1 }])),
        })
      if (path.startsWith('/api/user/models?')) {
        const group = new URL(path, 'http://localhost').searchParams.get('group') || ''
        if (!groups.includes(group))
          return Response.json({ success: false, message: 'Group access denied' }, { status: 403 })
        return Response.json({ success: true, data: [`${group}-model`] })
      }
      if (path.startsWith('/api/pricing/quote?'))
        return Response.json({
          success: true,
          data: {
            quotes: [
              {
                label: 'Current price',
                billing_mode: 'per_call',
                billing_unit: 'request',
                usd: 0.25,
              },
            ],
          },
        })
      throw new Error(`Unexpected test request ${path}`)
    }),
  )
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SessionProvider>
          <ActivePlanSummary />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}
const plan: UserSubscription = {
  id: 1,
  plan_id: 1,
  amount_total: 5000000,
  amount_used: 1250000,
  start_time: 1790000000,
  end_time: 1890000000,
  status: 'active',
  next_reset_time: 1800000000,
  allowed_token_groups: 'codeplan',
  allow_wallet_overflow: false,
}

it('shows each active plan separately with balance, cycle and group restrictions', async () => {
  await showPlans([
    plan,
    {
      ...plan,
      id: 2,
      plan_id: 2,
      amount_total: 0,
      next_reset_time: 0,
      allow_wallet_overflow: true,
    },
  ])
  const code = await screen.findByRole('region', { name: 'Code plan' })
  expect(within(code).getByText('$7.50')).toBeVisible()
  expect(within(code).getByText('$2.50')).toBeVisible()
  expect(within(code).getByText('$10.00')).toBeVisible()
  expect(
    within(code).getByRole('progressbar', { name: 'Remaining plan allowance' }),
  ).toHaveAttribute('value', '75')
  expect(within(code).getByText(/codeplan/)).toBeVisible()
  expect(within(code).getByText('Requests stop when allowance runs out')).toBeVisible()
  expect(within(code).getByText('Next reset')).toBeVisible()
  expect(within(code).getByText('Expires')).toBeVisible()
  const unlimited = screen.getByRole('region', { name: 'Unlimited plan' })
  expect(within(unlimited).getAllByText('Unlimited allowance')).toHaveLength(2)
  expect(within(unlimited).queryByRole('progressbar')).not.toBeInTheDocument()
  expect(within(unlimited).getByText('No scheduled reset')).toBeVisible()
  expect(within(unlimited).getByText('Wallet pays when allowance runs out')).toBeVisible()
})
it('uses server active entries only and excludes expired history from the summary', async () => {
  await showPlans([], [{ ...plan, status: 'expired' }])
  expect(
    await screen.findByText('No active plan. Wallet balance and plan allowances are separate.'),
  ).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Code plan' })).not.toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})
it('clamps exhausted remaining allowance and progress without changing recorded usage', async () => {
  await showPlans([{ ...plan, amount_used: 6000000 }])
  const card = await screen.findByRole('region', { name: 'Code plan' })
  expect(within(card).getByText('$0.00')).toBeVisible()
  expect(within(card).getByText('$12.00')).toBeVisible()
  expect(within(card).getByRole('progressbar')).toHaveAttribute('value', '0')
})

it('rounds fractional monetary allowances to two decimals in plan summaries', async () => {
  await showPlans([{ ...plan, amount_total: 5000001, amount_used: 1250002 }])
  const code = await screen.findByRole('region', { name: 'Code plan' })
  expect(within(code).getByText('$7.50')).toBeVisible()
  expect(within(code).getByText('$2.50')).toBeVisible()
  expect(within(code).getByText('$10.00')).toBeVisible()
})

it('opens current authorized models from an active plan even after it leaves the sale catalog', async () => {
  await showPlans([{ ...plan, plan_id: 99 }])
  await userEvent.click(await screen.findByRole('button', { name: 'codeplan' }))
  const dialog = await screen.findByRole('dialog', { name: 'View supported models and prices' })
  expect(await within(dialog).findByText('codeplan-model')).toBeVisible()
  expect(await within(dialog).findByText('$0.25')).toBeVisible()
  expect(within(dialog).queryByText('default-model')).not.toBeInTheDocument()
  expect(
    vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('/plans/99/pricing')),
  ).toBe(false)
})
it('allows an unrestricted active plan to compare its currently available service groups', async () => {
  await showPlans([{ ...plan, allowed_token_groups: '' }])
  await userEvent.click(await screen.findByRole('button', { name: 'All available groups' }))
  const dialog = await screen.findByRole('dialog', { name: 'View supported models and prices' })
  expect(await within(dialog).findByText('default-model')).toBeVisible()
  await userEvent.click(within(dialog).getByRole('button', { name: /codeplan/ }))
  expect(await within(dialog).findByText('codeplan-model')).toBeVisible()
  expect(within(dialog).queryByText('default-model')).not.toBeInTheDocument()
})
it('explains lost group access rather than silently showing models from another group', async () => {
  await showPlans([{ ...plan, allowed_token_groups: 'retired' }])
  await userEvent.click(await screen.findByRole('button', { name: 'retired' }))
  expect(
    await screen.findByText(
      'This service group is not available to your account. Contact the administrator to check access.',
    ),
  ).toBeVisible()
  expect(screen.queryByText('default-model')).not.toBeInTheDocument()
})

it('shows an access explanation instead of an endless loader when no groups are available', async () => {
  await showPlans([{ ...plan, allowed_token_groups: '' }], [], [])
  await userEvent.click(await screen.findByRole('button', { name: 'All available groups' }))
  expect(
    await screen.findByText(
      'This service group is not available to your account. Contact the administrator to check access.',
    ),
  ).toBeVisible()
  expect(screen.queryByText('Loading your space…')).not.toBeInTheDocument()
})

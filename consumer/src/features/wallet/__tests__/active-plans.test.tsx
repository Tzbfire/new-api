import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { ActivePlanSummary } from '../ActivePlanSummary'
import type { UserSubscription } from '../api'

afterEach(() => vi.unstubAllGlobals())
async function showPlans(active: UserSubscription[], history: UserSubscription[] = []) {
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
        <ActivePlanSummary />
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

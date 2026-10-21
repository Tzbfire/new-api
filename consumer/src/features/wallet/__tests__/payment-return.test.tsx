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
import { expect, it, vi } from 'vitest'
import { PaymentReturnStatus } from '../PaymentReturnStatus'
import { paymentReturnSearch } from '../payment-return'

const refreshUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/session', () => ({ useSession: () => ({ refreshUser }) }))

it.each(['success', 'pending', 'fail'])(
  'treats the %s payment return as unconfirmed and only refreshes reads',
  async (pay) => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const router = createRouter({
      routeTree: createRootRoute({
        component: PaymentReturnStatus,
        validateSearch: paymentReturnSearch,
      }),
      history: createMemoryHistory({ initialEntries: [`/?pay=${pay}`] }),
    })
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    )
    expect(
      await screen.findByText(
        'A payment redirect does not confirm that your balance has been credited.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'View orders' })).toHaveAttribute(
      'href',
      `/orders?pay=${pay}`,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refreshUser).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['topup-orders'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['subscriptions'] })
    client.clear()
  },
)

it('discards forged payment outcomes and enables history only explicitly', () => {
  expect(paymentReturnSearch({ pay: 'credited', show_history: 'false' })).toEqual({
    pay: undefined,
    show_history: undefined,
  })
  expect(paymentReturnSearch({ pay: 'pending', show_history: true })).toEqual({
    pay: 'pending',
    show_history: true,
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { clearAuth } from '@/lib/auth-state'
import OrdersPage from '../OrdersPage'

vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { id: 61 } }) }))

afterEach(() => vi.unstubAllGlobals())

async function setup(fetcher: (path: string) => Promise<Response>) {
  clearAuth()
  vi.stubGlobal('fetch', fetcher)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const router = createRouter({
    routeTree: createRootRoute({ component: OrdersPage }),
    history: createMemoryHistory(),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

it('requests the chosen order page and resets to the first page when page size or search changes', async () => {
  const fetcher = vi.fn(async (_path: string) =>
    Response.json({ success: true, data: { items: [], total: 65 } }),
  )
  await setup(fetcher)
  const user = userEvent.setup()
  await user.type(
    await screen.findByRole('spinbutton', { name: 'Go to page' }),
    '{Control>}a{/Control}3{Enter}',
  )
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/user/topup/self?p=3&page_size=15&status=success&keyword=',
      expect.anything(),
    ),
  )
  await user.click(screen.getByRole('combobox', { name: 'Rows per page' }))
  await user.click(await screen.findByRole('option', { name: '30' }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/user/topup/self?p=1&page_size=30&status=success&keyword=',
      expect.anything(),
    ),
  )
  await user.click(await screen.findByRole('button', { name: 'Page 2' }))
  await user.type(screen.getByRole('textbox', { name: 'Search orders' }), 'abc&123')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/user/topup/self?p=1&page_size=30&status=success&keyword=abc%26123',
      expect.anything(),
    ),
  )
})

it('retains visible orders during page loading and removes them when the search changes', async () => {
  let resolvePage!: (value: Response) => void
  const deferredPage = new Promise<Response>((resolve) => {
    resolvePage = resolve
  })
  let resolveSearch!: (value: Response) => void
  const deferredSearch = new Promise<Response>((resolve) => {
    resolveSearch = resolve
  })
  const order = {
    id: 1,
    trade_no: 'fixture-order-one',
    create_time: 1790000000,
    payment_method: 'alipay',
    money: 10,
    status: 'success',
  }
  await setup(async (path) => {
    if (path.includes('keyword=missing')) return deferredSearch
    if (path.includes('p=2')) return deferredPage
    return Response.json({ success: true, data: { items: [order], total: 20 } })
  })
  const user = userEvent.setup()
  await screen.findByText('fixture-order-one')
  const table = screen.getByRole('table')
  const loadingStatus = screen.getByTestId('orders-page-status')
  expect(loadingStatus).toHaveTextContent('')
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  expect(screen.getByRole('table')).toBe(table)
  expect(screen.getByText('fixture-order-one')).toBeVisible()
  expect(screen.getByTestId('orders-page-status')).toBe(loadingStatus)
  expect(loadingStatus).toHaveTextContent('Loading…')
  await act(async () =>
    resolvePage(
      Response.json({
        success: true,
        data: { items: [{ ...order, id: 2, trade_no: 'fixture-order-two' }], total: 20 },
      }),
    ),
  )
  await screen.findByText('fixture-order-two')
  expect(screen.getByTestId('orders-page-status')).toBe(loadingStatus)
  expect(loadingStatus).toHaveTextContent('')
  await user.type(screen.getByRole('textbox', { name: 'Search orders' }), 'missing')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.queryByText('fixture-order-two')).not.toBeInTheDocument()
  await act(async () =>
    resolveSearch(Response.json({ success: true, data: { items: [], total: 0 } })),
  )
})

it('shows only completed payments from the server and explains an empty payment history', async () => {
  const completed = {
    id: 2,
    trade_no: 'completed-order',
    create_time: 1790000000,
    payment_method: 'alipay',
    money: 10,
    status: 'success',
  }
  const pending = { ...completed, id: 3, trade_no: 'pending-order', status: 'pending' }
  const fetcher = vi.fn(async (path: string) => {
    const params = new URL(path, 'https://example.com').searchParams
    if (params.get('keyword') === 'missing') {
      return Response.json({ success: true, data: { items: [], total: 0 } })
    }
    const items = params.get('status') === 'success' ? [completed] : [pending, completed]
    return Response.json({ success: true, data: { items, total: items.length } })
  })
  await setup(fetcher)
  expect(await screen.findByText('completed-order')).toBeVisible()
  expect(screen.queryByText('pending-order')).not.toBeInTheDocument()
  expect(screen.getByText('Only completed payments are shown.')).toBeVisible()
  expect(screen.getByText('1–1 of 1')).toBeVisible()
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Search orders' }), 'missing')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByText('No matching payments')).toBeVisible()
  expect(screen.queryByText('completed-order')).not.toBeInTheDocument()
})

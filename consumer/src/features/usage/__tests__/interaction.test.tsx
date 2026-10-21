import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { expect, it } from 'vitest'
import { SpendingChart } from '../SpendingChart'

it('exposes server quantities on hover, keyboard focus and tap with a matching selected state', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(['status'], { quota_per_unit: 500000 })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SpendingChart
          daily={[
            { date: 1792281600, quota: 500000, count: 7, token_used: 1200 },
            { date: 1792368000, quota: 0 },
          ]}
        />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const days = screen.getAllByRole('button')
  expect(days[1]).toHaveAttribute('aria-pressed', 'true')
  fireEvent.mouseEnter(days[0]!)
  expect(days[0]).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('status')).toHaveTextContent('Requests: 7')
  expect(screen.getByRole('status')).toHaveTextContent('Tokens: 1,200')
  fireEvent.keyDown(days[0]!, { key: 'Tab' })
  fireEvent.focus(days[1]!)
  fireEvent.mouseEnter(days[0]!)
  expect(days[1]).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('status')).not.toHaveTextContent('Requests')
  fireEvent.pointerMove(days[0]!)
  fireEvent.mouseEnter(days[0]!)
  fireEvent.click(days[0]!)
  expect(screen.getByRole('status')).toHaveTextContent('Requests: 7')
})

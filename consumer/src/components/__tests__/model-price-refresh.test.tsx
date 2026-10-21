import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelPrice } from '../model-price'
afterEach(() => vi.unstubAllGlobals())
it('retains the previous sample while updating and never labels it with the new inputs', async () => {
  let finish: ((value: Response) => void) | undefined
  const pending = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const data = (input: number, usd: number) =>
    Response.json({
      success: true,
      data: {
        group: 'default',
        group_ratio: 1,
        input_tokens: input,
        output_tokens: 1000,
        image_count: 1,
        quotes: [{ billing_unit: 'token', usd }],
      },
    })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      new URL(path, 'http://localhost').searchParams.get('input_tokens') === '2000'
        ? pending
        : data(1000, 0.006),
    ),
  )
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={new QueryClient()}>
        <ModelPrice model="chat" group="default" />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const statusSlot = screen.getByRole('status')
  expect(await screen.findByText('$0.006')).toBeVisible()
  expect(screen.getByRole('status')).toBe(statusSlot)
  const user = userEvent.setup()
  await user.clear(screen.getByRole('spinbutton', { name: 'Input tokens' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Input tokens' }), '2000')
  await user.click(screen.getByRole('button', { name: 'Calculate' }))
  expect(screen.getByText('$0.006')).toBeVisible()
  expect(screen.getByText('1,000 input + 1,000 output tokens')).toBeVisible()
  expect(screen.getByText('Updating price for this example…')).toBeVisible()
  expect(screen.getByRole('status')).toBe(statusSlot)
  await act(async () => finish?.(data(2000, 0.008)))
  expect(await screen.findByText('$0.008')).toBeVisible()
  expect(screen.getByRole('status')).toBe(statusSlot)
  expect(screen.getByText('2,000 input + 1,000 output tokens')).toBeVisible()
})

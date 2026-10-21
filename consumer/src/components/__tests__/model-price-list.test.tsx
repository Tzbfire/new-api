import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { PropsWithChildren } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelPriceList, ModelPriceSummary } from '../model-price-list'

afterEach(() => vi.unstubAllGlobals())

async function renderPrices(
  quotes: Record<string, unknown[]>,
  summary: false | 'compact' | 'comparison' = false,
) {
  const fetcher = vi.fn(async (path: string) => {
    const url = new URL(path, 'http://localhost')
    expect(url.pathname).toBe('/api/pricing/quote')
    expect(url.searchParams.get('group')).toBe('codeplan')
    return Response.json({
      success: true,
      data: { group: 'codeplan', group_ratio: 2, quotes: quotes[url.searchParams.get('model')!] },
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    summary ? (
      <ModelPriceSummary
        model={Object.keys(quotes)[0]!}
        group="codeplan"
        compact={summary === 'compact'}
        showExample
      />
    ) : (
      <ModelPriceList
        group="codeplan"
        models={Object.keys(quotes).map((model_name) => ({
          model_name,
          supported_endpoint_types: ['openai'],
        }))}
      />
    ),
    {
      wrapper: (props: PropsWithChildren) => (
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
        </I18nextProvider>
      ),
    },
  )
  return view
}

it('compares server unit prices without multiplying again and opens only the selected calculator', async () => {
  const quote = {
    billing_unit: 'token',
    usd: 0.024,
    matched_tier: '0_272k',
    billing_explanation: { status: 'available', unit_prices: { p: 4, c: 20, cr: 0.4, cc: 0 } },
  }
  await renderPrices({ 'chat-one': [quote], 'chat-two': [quote] })
  const first = await screen.findByRole('article', { name: 'chat-one' })
  expect(await within(first).findByText('$4.00')).toBeVisible()
  expect(within(first).getByText('$20.00')).toBeVisible()
  expect(within(first).getByText('$0.40')).toBeVisible()
  expect(within(first).getByText('$0.00')).toBeVisible()
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(within(first).getByRole('button', { name: 'View pricing for chat-one' }))
  expect(within(first).getByRole('button', { name: 'View pricing for chat-one' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  const second = screen.getByRole('article', { name: 'chat-two' })
  await user.click(within(second).getByRole('button', { name: 'View pricing for chat-two' }))
  expect(within(first).queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(within(second).getByRole('spinbutton', { name: 'Input tokens' })).toBeVisible()
  await user.type(screen.getByRole('searchbox', { name: 'Search models' }), 'not-present')
  expect(screen.getByText('No models found')).toBeVisible()
})

it('shows the server example total separately from per-million unit prices for a new user', async () => {
  await renderPrices(
    {
      'chat-example': [
        {
          billing_unit: 'token',
          usd: 0.024,
          billing_explanation: { status: 'available', unit_prices: { p: 4, c: 20 } },
        },
      ],
    },
    'compact',
  )
  expect(await screen.findByText('$0.024')).toBeVisible()
  expect(screen.getByText('$4.00')).toBeVisible()
  expect(screen.getByText('$20.00')).toBeVisible()
  expect(screen.getByText('USD per million tokens')).toBeVisible()
  expect(screen.getByText('1,000 input + 1,000 output tokens')).toBeVisible()
  expect(
    screen.getByText(
      'Tokens measure text processed by the model. Your service plan multiplier adjusts its price.',
    ),
  ).toBeVisible()
})

it('labels token and per-request group comparisons with their actual billing units', async () => {
  const quote = {
    billing_unit: 'token',
    usd: 0.024,
    billing_explanation: { status: 'available', unit_prices: { p: 4, c: 20 } },
  }
  await renderPrices({ 'comparison-chat': [quote] }, 'comparison')
  expect(await screen.findByText('$0.024')).toBeVisible()
  expect(screen.getByText('USD per million tokens')).toBeVisible()
  await renderPrices({ 'comparison-image': [{ billing_unit: 'request', usd: 0.04 }] }, 'comparison')
  expect(await screen.findByText('$0.04')).toBeVisible()
  expect(screen.getByText('per request')).toBeVisible()
  expect(screen.getAllByText('USD per million tokens')).toHaveLength(1)
})

it('hides cached example prices when the model is no longer available in a group', async () => {
  const view = await renderPrices(
    {
      'restricted-chat': [
        {
          billing_unit: 'token',
          usd: 0.024,
          billing_explanation: { status: 'available', unit_prices: { p: 4, c: 20 } },
        },
      ],
    },
    'compact',
  )
  expect(await screen.findByText('$0.024')).toBeVisible()
  view.rerender(
    <ModelPriceSummary
      model="restricted-chat"
      group="codeplan"
      enabled={false}
      compact
      showExample
    />,
  )
  expect(screen.getByText('Unavailable in this group. Compare other groups.')).toBeVisible()
  expect(screen.queryByText('$0.024')).not.toBeInTheDocument()
  expect(screen.queryByText('USD per million tokens')).not.toBeInTheDocument()
})

it('distinguishes unavailable prices, request charges and multiple rates from token prices', async () => {
  await renderPrices({
    'not-configured': [{ billing_unit: 'token', unavailable_reason: 'pricing_not_configured' }],
    'image-model': [{ billing_unit: 'token', unavailable_reason: 'Request parameters required' }],
    'per-call': [{ billing_unit: 'request', usd: 0.42 }],
    multiple: [
      { billing_unit: 'token', usd: 0.1 },
      { billing_unit: 'token', usd: 0.2 },
    ],
  })
  expect(await screen.findByText('$0.42')).toBeVisible()
  expect(screen.getByText('per request')).toBeVisible()
  expect(
    within(screen.getByRole('article', { name: 'image-model' })).getByText(
      'Priced by request options',
    ),
  ).toBeVisible()
  expect(
    within(screen.getByRole('article', { name: 'multiple' })).getByText('Multiple pricing rules'),
  ).toBeVisible()
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  expect(
    within(screen.getByRole('article', { name: 'not-configured' })).getByText(
      'pricing_not_configured',
    ),
  ).toBeVisible()
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
})

it('keeps request charges out of token columns even when the server also provides token rates', async () => {
  await renderPrices({
    'per-request': [
      {
        billing_unit: 'request',
        usd: 0.42,
        billing_explanation: { status: 'available', unit_prices: { p: 99, c: 99 } },
      },
    ],
  })
  const row = screen.getByRole('article', { name: 'per-request' })
  expect(await within(row).findByText('$0.42')).toBeVisible()
  expect(within(row).getByText('per request')).toBeVisible()
  expect(within(row).queryByText('$99.00')).not.toBeInTheDocument()
  expect(screen.queryByText('USD per million tokens')).not.toBeInTheDocument()
})

it.each([0.075, 0])(
  'shows the server image base price %s without a misleading token calculator',
  async (price) => {
    await renderPrices({
      'gpt-image-2': [
        {
          billing_unit: 'request',
          supports_token_input: false,
          base_price_usd: price,
          price_scope: 'base',
          unavailable_reason: 'request_parameters_required',
        },
      ],
    })
    const row = screen.getByRole('article', { name: 'gpt-image-2' })
    expect(await within(row).findByText(price === 0 ? '$0.00' : '$0.075')).toBeVisible()
    expect(within(row).getByText('Base price')).toBeVisible()
    expect(within(row).getByText('per request')).toBeVisible()
    expect(within(row).queryByText('Input price')).not.toBeInTheDocument()
    await userEvent
      .setup()
      .click(within(row).getByRole('button', { name: 'View pricing for gpt-image-2' }))
    expect(within(row).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Calculate' })).not.toBeInTheDocument()
    expect(
      within(row).getByText(
        'Base price for one image. Quantity, size and quality may change the final charge.',
      ),
    ).toBeVisible()
    expect(within(row).getByText('Includes 2× service plan multiplier')).toBeVisible()
  },
)

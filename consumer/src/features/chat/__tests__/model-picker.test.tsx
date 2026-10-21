import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'
import { CatalogProvider } from '@/lib/catalog'
import { usePreferredModel } from '@/lib/use-preferred-model'
import { ChatModelPicker } from '../ChatModelPicker'

vi.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', user: { id: 64, group: 'everyday' } }),
}))
const requests = vi.hoisted(() => ({ allowed: vi.fn(), quote: vi.fn() }))
vi.mock('@/lib/api', () => ({
  rawRequest: async () => ({
    data: [
      { model_name: 'second-chat', supported_endpoint_types: ['openai'] },
      { model_name: 'everyday-chat', supported_endpoint_types: ['openai'] },
      {
        model_name: 'premium-chat',
        supported_endpoint_types: ['anthropic'],
        description: 'Premium fixture',
      },
      { model_name: 'forbidden-chat', supported_endpoint_types: ['openai'] },
      { model_name: 'gpt-image-2', supported_endpoint_types: ['openai'] },
    ],
  }),
  request: async (path: string) => {
    if (path === '/api/user/self/groups')
      return {
        everyday: { desc: 'Everyday fixture', ratio: 1 },
        premium: { desc: 'Premium fixture', ratio: 2 },
        empty: { desc: 'No chat fixture', ratio: 3 },
      }
    if (path.startsWith('/api/user/models')) return requests.allowed(path)
    if (path.startsWith('/api/pricing/quote')) {
      requests.quote(path)
      return {
        group: 'everyday',
        group_ratio: 1,
        quotes: [
          {
            label: 'Synthetic authoritative quote',
            billing_mode: 'fixed',
            billing_unit: 'usage',
            usd: 0.125,
          },
        ],
      }
    }
    throw Error('Unexpected fixture request')
  },
}))

function Fixture(props: { disabled?: boolean }) {
  const [model, setModel] = usePreferredModel('chat')
  const [disabled, setDisabled] = useState(props.disabled)
  return (
    <>
      <button onClick={() => setDisabled(true)}>Disable picker</button>
      <ChatModelPicker model={model} onModelChange={setModel} disabled={disabled} />
      <output aria-label="Chosen model">{model}</output>
    </>
  )
}
async function setup(disabled = false) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CatalogProvider scope="chat">
          <Fixture disabled={disabled} />
        </CatalogProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}
beforeEach(() => {
  localStorage.clear()
  requests.quote.mockReset()
  requests.allowed.mockImplementation(async (path: string) =>
    path.includes('premium')
      ? ['premium-chat']
      : path.includes('empty')
        ? ['gpt-image-2']
        : ['everyday-chat', 'second-chat', 'gpt-image-2'],
  )
})
it('switches authorized groups without closing and selects that group’s model before closing', async () => {
  await setup()
  await waitFor(() =>
    expect(screen.getByLabelText('Chosen model')).toHaveTextContent('everyday-chat'),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Choose your chat model' }))
  expect(screen.getByText('Your account default')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'everyday-chat' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.queryByRole('button', { name: 'premium-chat' })).not.toBeInTheDocument()
  expect(screen.queryByText('gpt-image-2')).not.toBeInTheDocument()
  expect(screen.queryByText('forbidden-chat')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /premium.*2×/ }))
  expect(
    await screen.findByRole('button', { name: /premium-chat.*Premium fixture/ }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'everyday-chat' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /premium-chat.*Premium fixture/ }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Chosen model')).toHaveTextContent('premium-chat')
})
it('offers a clear empty chat group and allows switching back without exposing image models', async () => {
  await setup()
  fireEvent.click(screen.getByRole('button', { name: 'Choose your chat model' }))
  fireEvent.click(await screen.findByRole('button', { name: /empty.*3×/ }))
  expect(
    await screen.findByText('This service plan has no chat models available.'),
  ).toBeInTheDocument()
  expect(screen.queryByText('gpt-image-2')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /everyday.*1×/ }))
  expect(await screen.findByRole('button', { name: 'everyday-chat' })).toBeInTheDocument()
})
it('keeps a disabled trigger closed and cannot query prices from hidden choices', async () => {
  await setup(true)
  const trigger = screen.getByRole('button', { name: 'Choose your chat model' })
  expect(trigger).toBeDisabled()
  fireEvent.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(requests.quote).not.toHaveBeenCalled()
})
it('searches current authorized chat models and leaves selection intact when canceled', async () => {
  await setup()
  await waitFor(() =>
    expect(screen.getByLabelText('Chosen model')).toHaveTextContent('everyday-chat'),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Choose your chat model' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search chat models' }), {
    target: { value: 'missing' },
  })
  expect(screen.getByText('No matching models')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByLabelText('Chosen model')).toHaveTextContent('everyday-chat')
})

it('recovers a failed group model lookup through the existing catalog retry', async () => {
  requests.allowed.mockRejectedValueOnce(new Error('Synthetic outage'))
  await setup()
  fireEvent.click(screen.getByRole('button', { name: 'Choose your chat model' }))
  expect(await screen.findByText('Models could not be loaded.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('button', { name: 'everyday-chat' })).toBeInTheDocument()
})

it('previews an authorized model and server quote without committing until confirmation', async () => {
  await setup()
  await waitFor(() =>
    expect(screen.getByLabelText('Chosen model')).toHaveTextContent('everyday-chat'),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Choose your chat model' }))
  fireEvent.click(screen.getByRole('button', { name: 'second-chat' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByLabelText('Chosen model')).toHaveTextContent('everyday-chat')
  expect(screen.getByRole('button', { name: 'second-chat' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(await screen.findByText('Synthetic authoritative quote')).toBeInTheDocument()
  await waitFor(() =>
    expect(
      requests.quote.mock.calls.some(
        ([path]) => path.includes('model=second-chat') && path.includes('group=everyday'),
      ),
    ).toBe(true),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Chosen model')).toHaveTextContent('second-chat')
})

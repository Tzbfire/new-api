import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { APIAddressSelector } from '../APIAddressSelector'

vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { id: 31 } }) }))
vi.mock('@/lib/status', () => ({
  useStatus: () => ({
    data: {
      api_info: [
        {
          url: 'https://domestic.example.test',
          route: 'Domestic',
          description: 'For local network connections',
        },
        {
          url: 'https://cdn.example.test',
          route: 'CDN',
          description: 'For global network connections',
        },
        {
          url: 'https://alternative.example.test',
          route: 'Alternative',
          description: 'Another published route',
        },
      ],
    },
  }),
}))
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('shows address descriptions, shares and persists choices, and copies without fetching secrets', async () => {
  const user = userEvent.setup()
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const view = render(
    <I18nextProvider i18n={i18n}>
      <section aria-label="Inline">
        <APIAddressSelector inline />
      </section>
      <section aria-label="Setup">
        <APIAddressSelector />
      </section>
    </I18nextProvider>,
  )
  const inline = within(screen.getByRole('region', { name: 'Inline' }))
  expect(inline.getByText('For local network connections')).toBeVisible()
  await user.click(inline.getByRole('combobox', { name: 'API address' }))
  expect(
    await screen.findByRole('option', { name: /Alternative.*Another published route/ }),
  ).toBeVisible()
  await user.click(screen.getByRole('option', { name: /CDN.*For global network/ }))
  expect(inline.getByText('https://cdn.example.test')).toBeVisible()
  expect(
    within(screen.getByRole('region', { name: 'Setup' })).getByText(
      'For global network connections',
    ),
  ).toBeVisible()
  await user.click(inline.getByRole('button', { name: 'Copy' }))
  expect(copy).toHaveBeenCalledWith('https://cdn.example.test')
  expect(fetcher).not.toHaveBeenCalled()
  view.unmount()
  render(
    <I18nextProvider i18n={i18n}>
      <APIAddressSelector inline />
    </I18nextProvider>,
  )
  expect(screen.getByText('https://cdn.example.test')).toBeVisible()
})

it('falls back to a published gateway when the saved address was removed', async () => {
  localStorage.setItem('factory:choice:31:api-address', 'https://removed.example.test')
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <APIAddressSelector inline />
    </I18nextProvider>,
  )
  expect(screen.getByText('https://domestic.example.test')).toBeVisible()
  expect(screen.queryByText('https://removed.example.test')).not.toBeInTheDocument()
})

it('keeps another account’s preference separate and supports keyboard selection', async () => {
  localStorage.setItem('factory:choice:99:api-address', 'https://cdn.example.test')
  const user = userEvent.setup()
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <APIAddressSelector inline />
    </I18nextProvider>,
  )
  const chooser = screen.getByRole('combobox', { name: 'API address' })
  expect(screen.getByText('https://domestic.example.test')).toBeVisible()
  chooser.focus()
  await user.keyboard('{Enter}')
  await screen.findByRole('option', { name: /CDN.*For global network/ })
  expect(chooser).toHaveAttribute('aria-expanded', 'true')
  await user.type(screen.getByRole('combobox', { name: 'Search API address' }), 'CDN')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(screen.getByText('https://cdn.example.test')).toBeVisible()
  expect(chooser).toHaveAttribute('aria-expanded', 'false')
})

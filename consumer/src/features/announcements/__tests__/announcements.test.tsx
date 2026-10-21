import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { AnnouncementButton, AnnouncementsProvider } from '../index'

const location = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('@tanstack/react-router', () => ({ useLocation: () => location }))
let notice = ''
let enabled = true
let failed = false
let updates: unknown[] = []
let language = createInstance()

// These tests exercise notice state, not the test runner's lazy-module transform time.
beforeAll(async () => {
  await import('../content')
})

beforeEach(async () => {
  language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  localStorage.clear()
  sessionStorage.clear()
  location.pathname = '/'
  notice = '**Maintenance window**\n\nNo action is needed.'
  enabled = true
  failed = false
  updates = [
    { id: 1, content: 'New image models', publishDate: '2026-10-20T08:00:00Z', type: 'success' },
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/notice' && failed)
        return Response.json({ success: false, message: 'Notice unavailable' }, { status: 503 })
      return Response.json({
        success: true,
        data:
          path === '/api/notice'
            ? notice
            : { announcements_enabled: enabled, announcements: updates },
      })
    }),
  )
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    client,
    ...render(
      <I18nextProvider i18n={language}>
        <QueryClientProvider client={client}>
          <AnnouncementsProvider>
            <AnnouncementButton />
          </AnnouncementsProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    ),
  }
}

it('shows a notice once per tab, supports reopening, and detects edits after acknowledgment', async () => {
  const view = setup()
  expect(await screen.findByRole('dialog', { name: 'Announcements' })).toBeVisible()
  expect((await screen.findByText('Maintenance window')).tagName).toBe('STRONG')
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.unmount()
  const second = setup()
  await waitFor(() => expect(second.client.getQueryData(['site-notice'])).toBe(notice))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Announcements/ }))
  fireEvent.click(screen.getByRole('tab', { name: 'System notice' }))
  expect(await screen.findByText('Maintenance window')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
  notice = 'Maintenance was rescheduled.'
  await second.client.invalidateQueries({ queryKey: ['site-notice'] })
  expect(await screen.findByText('Maintenance was rescheduled.')).toBeVisible()
})

it('snoozes across new tabs today but a changed notice is shown again', async () => {
  const first = setup()
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Do not remind me today' }))
  first.unmount()
  sessionStorage.clear()
  const next = setup()
  await waitFor(() => expect(next.client.getQueryData(['site-notice'])).toBe(notice))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  notice = 'A newly published notice'
  await next.client.invalidateQueries({ queryKey: ['site-notice'] })
  expect(await screen.findByText('A newly published notice')).toBeVisible()
})

it('shows the same notice again after the daily dismissal expires', async () => {
  const first = setup()
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Do not remind me today' }))
  first.unmount()
  const tomorrow = Date.now() + 2 * 86_400_000
  vi.spyOn(Date, 'now').mockReturnValue(tomorrow)
  setup()
  expect(await screen.findByRole('dialog')).toBeVisible()
})

it('allows arrow-key tab navigation and tolerates malformed historical entries', async () => {
  updates = [
    null,
    4,
    { content: {} },
    { id: 2, content: 'Historical update', publishDate: 'invalid' },
  ]
  setup()
  await screen.findByRole('dialog')
  const tab = screen.getByRole('tab', { name: 'System notice' })
  tab.focus()
  fireEvent.keyDown(tab, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Platform updates' })).toHaveFocus()
  expect(await screen.findByText('Historical update')).toBeVisible()
  expect(screen.getByRole('tabpanel').querySelector('time')).toBeNull()
})

it('respects the timeline switch and counts edits to an existing announcement as unread', async () => {
  notice = ''
  const view = setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Announcements, 1 unread' }))
  expect(await screen.findByText('New image models')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  updates = [{ id: 1, content: 'Updated model availability', type: 'warning' }]
  await view.client.invalidateQueries({ queryKey: ['status'] })
  expect(await screen.findByRole('button', { name: 'Announcements, 1 unread' })).toBeVisible()
  enabled = false
  await view.client.invalidateQueries({ queryKey: ['status'] })
  fireEvent.click(await screen.findByRole('button', { name: 'Announcements' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Platform updates' }))
  expect(screen.getByText('No platform updates yet')).toBeVisible()
})

it.each(['/login', '/reset', '/app/oauth/github'])(
  'does not interrupt authentication at %s',
  async (path) => {
    location.pathname = path
    const view = setup()
    await waitFor(() => expect(view.client.getQueryData(['site-notice'])).toBe(notice))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
)

it('sanitizes HTML, dangerous links and scripts while rendering ordinary rich content', async () => {
  notice =
    '<h2>Safe heading</h2><p>Read <strong>carefully</strong>.</p><script>window.bad=1</script><a href="javascript:alert(1)">Unsafe link</a><img src="/safe.png" onerror="alert(1)"><iframe src="https://example.invalid"></iframe>'
  setup()
  const dialog = await screen.findByRole('dialog')
  expect(screen.getByRole('heading', { name: 'Safe heading' })).toBeVisible()
  expect(screen.getByText('carefully').tagName).toBe('STRONG')
  expect(dialog.querySelector('script, iframe, [onerror], [href^="javascript:"]')).toBeNull()
})

it('keeps unread items on request failure and lets the user retry without an empty success state', async () => {
  failed = true
  setup()
  fireEvent.click(await screen.findByRole('button', { name: /Announcements/ }))
  fireEvent.click(screen.getByRole('tab', { name: 'System notice' }))
  expect(await screen.findByText('Notice unavailable')).toBeVisible()
  failed = false
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Maintenance window')).toBeVisible()
})

it('continues to show and dismiss notices when browser storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked')
  })
  setup()
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

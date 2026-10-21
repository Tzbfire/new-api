import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { clearAuth } from '@/lib/auth-state'
import { SessionProvider } from '@/lib/session'
import { savePreference } from '@/lib/preferences'
import LibraryPage from '../LibraryPage'
import type { StudioTask } from '../contracts'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('starts with all creations despite a saved collection and honors an explicit batch link', async () => {
  clearAuth()
  localStorage.clear()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  savePreference('public:studio:batch', 'failed-batch')
  savePreference('public:studio:page', '3')
  savePreference('public:studio:batch-page', '2')
  const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
    if (options?.method === 'DELETE') {
      expect(path).toBe('/api/image-studio/batches/failed-batch/failed')
      return Response.json({ success: true, data: { deleted: 1, batch_deleted: true } })
    }
    if (
      path.startsWith('/api/image-studio/batches?') ||
      path.startsWith('/api/image-studio/library/tasks?')
    )
      return Response.json({ success: true, data: { items: [], total: 0 } })
    if (path === '/api/user/self')
      return Response.json(
        { success: false, message: 'Synthetic unauthenticated user' },
        { status: 503 },
      )
    throw new Error(`Unexpected request ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  client.setQueryData(['status'], { quota_per_unit: 500000 })
  client.setQueryData(['studio', 'config'], { download_all_enabled: false })
  client.setQueryData(['studio', 'batches', 1], { items: [], total: 0 })
  client.setQueryData(['studio', 'library', 'failed-batch', 'all', 1], {
    items: [],
    total: 1,
    summary: {
      total_count: 1,
      finished_count: 1,
      success_count: 0,
      failure_count: 1,
      active_count: 0,
      queued_count: 0,
    },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: LibraryPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  expect(await screen.findByRole('combobox', { name: 'Collection' })).toHaveTextContent(
    'All creations',
  )
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/image-studio/library/tasks?p=1&'),
      expect.anything(),
    ),
  )
  await act(async () => router.navigate({ to: '/', search: { batch: 'failed-batch' } }))
  expect(
    screen.queryByRole('textbox', { name: 'Collection name on this device' }),
  ).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Collection options' }))
  await user.click(screen.getByRole('button', { name: 'Rename collection' }))
  const rename = await screen.findByRole('dialog', { name: 'Rename collection' })
  await user.type(
    within(rename).getByRole('textbox', { name: 'Collection name on this device' }),
    'Garden ideas',
  )
  await act(async () =>
    client.setQueryData(['studio', 'batches', 1], {
      items: [
        { batch_id: 'background-batch', model: 'image-model', prompt: '', status: 'running' },
      ],
      total: 1,
    }),
  )
  expect(
    within(rename).getByRole('textbox', { name: 'Collection name on this device' }),
  ).toHaveValue('Garden ideas')
  await user.click(within(rename).getByRole('button', { name: 'Save collection name' }))
  expect(within(rename).getByRole('status')).toHaveTextContent(
    'Collection name saved on this device.',
  )
  await user.click(within(rename).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Collection options' }))
  await user.click(screen.getByRole('button', { name: 'Clear failed tasks' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Collection' })).toHaveTextContent('All creations'),
  )
  expect(router.state.location.search).not.toHaveProperty('batch')
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  client.clear()
  localStorage.clear()
})

it('stacks the workspace on smaller screens and disables creation motion when requested', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/features/studio/studio.css', 'utf8')
  document.head.append(style)
  const rules = Array.from(style.sheet!.cssRules)
  const narrow = rules.find(
    (rule) => 'conditionText' in rule && rule.conditionText === '(max-width: 980px)',
  ) as CSSMediaRule
  const layout = Array.from(narrow.cssRules).find(
    (rule) => 'selectorText' in rule && rule.selectorText === '.studio-layout',
  ) as CSSStyleRule
  expect(layout.style.getPropertyValue('grid-template-columns')).toBe('minmax(0, 1fr)')
  const reduced = rules.find(
    (rule) => 'conditionText' in rule && rule.conditionText === '(prefers-reduced-motion: reduce)',
  ) as CSSMediaRule
  const motion = Array.from(reduced.cssRules).find(
    (rule): rule is CSSStyleRule =>
      'selectorText' in rule &&
      typeof rule.selectorText === 'string' &&
      rule.selectorText.includes('.studio-task-card'),
  ) as CSSStyleRule
  expect(motion.style.getPropertyValue('animation')).toBe('none')
  style.remove()
})

it.each(['SUCCESS', 'FAILURE'] as const)(
  'updates preview and usage when its running task becomes %s',
  async (taskStatus) => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    clearAuth()
    document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
    const fetcher = vi.fn(async (path: string) => {
      if (path === '/api/user/self')
        return Response.json(
          { success: false, message: 'Balance refresh unavailable' },
          { status: 503 },
        )
      if (path.startsWith('/api/image-studio/batches?'))
        return Response.json({ success: true, data: { items: [], total: 0 } })
      throw new Error(`Unexpected request ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const task: StudioTask = {
      id: 1,
      task_id: 'preview-task',
      group: 'default',
      quota: 500,
      status: 'IN_PROGRESS',
      created_at: 1,
      submit_time: 1_700_000_000,
      start_time: 1_700_000_005,
      finish_time: 1_700_000_023,
      data: {
        request: {
          prompt: 'A quiet garden',
          model: 'image-model',
          size: '1024x1536',
          quality: 'high',
          batch_size: 2,
          request_id: 'req-studio-public',
        },
      },
    }
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    client.setQueryData(['status'], { quota_per_unit: 500000 })
    client.setQueryData(['studio', 'config'], { download_all_enabled: false })
    client.setQueryData(['studio', 'batches', 1], { items: [], total: 0 })
    client.setQueryData(['studio', 'library', '', 'all', 1], { items: [task], total: 1 })
    client.setQueryData(['usage-logs'], { previous: true })
    const router = createRouter({
      routeTree: createRootRoute({ component: LibraryPage }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'View creation' })
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View creation' }))
    const dialog = await screen.findByRole('dialog', { name: 'Creation details' })
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument()
    expect(within(dialog).getByText('1024x1536')).not.toBeVisible()
    await user.click(within(dialog).getByText('Creation settings and identifiers'))
    expect(within(dialog).getByText('Submitted at')).toBeVisible()
    expect(within(dialog).getByText('Started at')).toBeVisible()
    expect(within(dialog).queryByText('18 s')).not.toBeInTheDocument()
    expect(within(dialog).getByText('1024x1536')).toBeVisible()
    expect(within(dialog).getByText('high')).toBeInTheDocument()
    expect(within(dialog).getByText('Task ID')).toBeInTheDocument()
    expect(within(dialog).getByText('req-studio-public')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('link', { name: 'Create again with these settings' }),
    ).toBeInTheDocument()
    await act(async () => {
      client.setQueryData(['studio', 'library', '', 'all', 1], {
        items: [
          {
            ...task,
            status: taskStatus,
            fail_reason: taskStatus === 'FAILURE' ? 'Provider declined this image' : undefined,
            data: {
              request: {
                prompt: 'A quiet garden',
                model: 'image-model',
                size: '1024x1536',
                quality: 'high',
                batch_size: 2,
                request_id: 'req-studio-public',
              },
              response:
                taskStatus === 'SUCCESS'
                  ? {
                      data: [
                        {
                          url: '/api/image-studio/assets/1/2/current-signature',
                          download_url: '/api/image-studio/assets/1/2/current-signature/download',
                          asset_status: 'ready',
                        },
                        {
                          url: '/api/image-studio/assets/2/2/second-signature',
                          download_url: '/api/image-studio/assets/2/2/second-signature/download',
                          asset_status: 'ready',
                        },
                      ],
                    }
                  : {},
            },
          },
        ],
        total: 1,
      })
    })
    expect(await within(dialog).findByText('18 s')).toBeVisible()
    if (taskStatus === 'SUCCESS') {
      expect(await within(dialog).findAllByRole('img', { name: 'A quiet garden' })).toHaveLength(2)
      expect(within(dialog).getByRole('link', { name: 'Download image 1' })).toHaveAttribute(
        'href',
        '/api/image-studio/assets/1/2/current-signature/download',
      )
      expect(within(dialog).getByRole('link', { name: 'Download image 2' })).toHaveAttribute(
        'href',
        '/api/image-studio/assets/2/2/second-signature/download',
      )
    } else
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Provider declined this image',
      )
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([path]) => path === '/api/user/self')).toHaveLength(1),
    )
    expect(client.getQueryState(['usage-logs'])?.isInvalidated).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('button', { name: 'Download selected' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select finished creations' }))
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeEnabled()
    if (taskStatus === 'SUCCESS')
      expect(screen.getByRole('button', { name: 'Download selected' })).toBeEnabled()
    else expect(screen.getByRole('button', { name: 'Download available 0' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Select finished creations' }))
    expect(screen.queryByRole('button', { name: 'Delete selected' })).not.toBeInTheDocument()
    client.setQueryData(['studio', 'library', '', 'failed', 1], { items: [], total: 0 })
    await user.click(screen.getByRole('button', { name: 'Failed' }))
    expect(
      await screen.findByRole('heading', { name: 'No creations match this filter' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Your next favorite image starts here.' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByRole('button', { name: 'View creation' })).toBeVisible()
    client.clear()
  },
)

it('keeps the creation grid and current pagination during a slow page request without permitting stale actions or retaining another filter', async () => {
  clearAuth()
  localStorage.clear()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  let resolvePage: ((value: Response) => void) | undefined
  let resolveFilter: ((value: Response) => void) | undefined
  const fetcher = vi.fn((path: string) => {
    if (path.startsWith('/api/image-studio/batches?'))
      return Promise.resolve(Response.json({ success: true, data: { items: [], total: 0 } }))
    if (path === '/api/user/self')
      return Promise.resolve(Response.json({ success: false }, { status: 503 }))
    if (path.includes('/tasks?') && path.includes('status=completed'))
      return new Promise<Response>((resolve) => {
        resolveFilter = resolve
      })
    if (path.includes('/tasks?') && path.includes('p=2'))
      return new Promise<Response>((resolve) => {
        resolvePage = resolve
      })
    return Promise.resolve(Response.json({ success: true, data: {} }))
  })
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const task: StudioTask = {
    id: 1,
    task_id: 'first-page',
    status: 'SUCCESS',
    group: 'default',
    quota: 0,
    created_at: 1,
    data: { request: { prompt: 'First page creation' } },
  }
  client.setQueryData(['status'], { quota_per_unit: 500000 })
  client.setQueryData(['studio', 'config'], {})
  client.setQueryData(['studio', 'batches', 1], { items: [], total: 0 })
  client.setQueryData(['studio', 'library', '', 'all', 1], { items: [task], total: 120 })
  const router = createRouter({
    routeTree: createRootRoute({ component: LibraryPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await screen.findByText('First page creation')
  const pageStatus = screen.getByTestId('studio-page-status')
  expect(pageStatus).toHaveTextContent('')
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  expect(screen.getByText('First page creation')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'View creation' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: 'Select image task' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.queryByRole('button', { name: 'Delete selected' })).not.toBeInTheDocument()
  expect(pageStatus).toHaveTextContent('Loading…')
  await act(async () =>
    resolvePage?.(
      Response.json({
        success: true,
        data: {
          items: [
            {
              ...task,
              task_id: 'second-page',
              data: { request: { prompt: 'Second page creation' } },
            },
          ],
          total: 120,
        },
      }),
    ),
  )
  await screen.findByText('Second page creation')
  expect(screen.queryByText('First page creation')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'View creation' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Completed' }))
  expect(screen.queryByText('Second page creation')).not.toBeInTheDocument()
  await act(async () =>
    resolveFilter?.(Response.json({ success: true, data: { items: [], total: 0 } })),
  )
  await screen.findByText('No creations match this filter')
})

it('keeps gallery controls contained on narrow screens and reserves refresh space while fetching', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/features/studio/gallery.css', 'utf8')
  document.head.append(style)
  const rules = Array.from(style.sheet!.cssRules)
  const refresh = rules.find(
    (rule) =>
      'selectorText' in rule && rule.selectorText === '.library-page .library-toolbar > .button',
  ) as CSSStyleRule
  expect(refresh.style.getPropertyValue('width')).toBe('40px')
  expect(refresh.style.getPropertyValue('height')).toBe('40px')
  const narrow = rules.find(
    (rule) => 'conditionText' in rule && rule.conditionText === '(max-width: 600px)',
  ) as CSSMediaRule
  const filters = Array.from(narrow.cssRules).find(
    (rule) => 'selectorText' in rule && rule.selectorText === '.library-page .library-filter-tabs',
  ) as CSSStyleRule
  expect(filters.style.getPropertyValue('width')).toBe('100%')
  expect(filters.style.getPropertyValue('overflow-x')).toBe('auto')
  style.remove()
})

it('downloads only available selected creations and states when library deletion ignores the status filter', async () => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
  const fetcher = vi.fn(async (path: string, _options?: RequestInit) => {
    if (path === '/api/image-studio/download-ticket')
      return Response.json({
        success: true,
        data: { url: '/api/image-studio/download/synthetic.zip' },
      })
    if (path === '/api/user/self') return Response.json({ success: false }, { status: 503 })
    return Response.json({ success: true, data: { items: [], total: 0 } })
  })
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  const task: StudioTask = {
    id: 1,
    task_id: 'ready',
    group: 'default',
    quota: 0,
    status: 'SUCCESS',
    created_at: 1,
    data: {
      request: { prompt: 'Synthetic product image' },
      response: { data: [{ url: '/api/image-studio/assets/1/2/ready', asset_status: 'ready' }] },
    },
  }
  const summary = {
    total_count: 2,
    finished_count: 2,
    success_count: 1,
    failure_count: 1,
    active_count: 0,
    queued_count: 0,
  }
  const tasks = {
    items: [task, { ...task, id: 2, task_id: 'failed', status: 'FAILURE', data: {} }],
    total: 2,
    summary,
  }
  client.setQueryData(['status'], { quota_per_unit: 500000 })
  client.setQueryData(['studio', 'config'], { download_all_enabled: true })
  client.setQueryData(['studio', 'batches', 1], { items: [], total: 0 })
  client.setQueryData(['studio', 'library', '', 'all', 1], tasks)
  client.setQueryData(['studio', 'library', '', 'failed', 1], { ...tasks, items: [tasks.items[1]] })
  const router = createRouter({
    routeTree: createRootRoute({ component: LibraryPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: 'Select finished creations' }))
  const download = screen.getByRole('button', { name: 'Download available 1' })
  expect(download).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Only selected creations with available images will be downloaded.',
  )
  const anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined)
  await user.click(download)
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith('/api/image-studio/download-ticket', expect.anything()),
  )
  const call = fetcher.mock.calls.find(([path]) => path === '/api/image-studio/download-ticket')!
  expect(JSON.parse(String(call[1]?.body))).toEqual({ scope: 'tasks', task_ids: ['ready'] })
  anchorClick.mockRestore()
  await user.click(screen.getByRole('button', { name: 'Failed' }))
  await user.click(screen.getByRole('button', { name: 'Collection options' }))
  const options = await screen.findByRole('dialog', { name: 'Collection options' })
  expect(within(options).getByRole('button', { name: 'Download all creations' })).toBeEnabled()
  await user.click(within(options).getByRole('button', { name: 'Delete all creations' }))
  const confirmation = await screen.findByRole('dialog', { name: 'Delete these creations?' })
  expect(confirmation).toHaveTextContent(
    'All finished creations in your library and their stored files will be permanently deleted, regardless of the current status filter. Running batches cannot be deleted.',
  )
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
  client.clear()
})

it('bounds gallery card width for sparse collections while auto-filling responsive batch columns', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/features/studio/studio.css', 'utf8')
  document.head.append(style)
  const rules = Array.from(style.sheet!.cssRules)
  for (const selector of ['.studio-gallery', '.studio-results .studio-gallery']) {
    const grid = rules.find(
      (rule) => 'selectorText' in rule && rule.selectorText === selector,
    ) as CSSStyleRule
    expect(grid.style.getPropertyValue('grid-template-columns')).toBe(
      'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
    )
    expect(grid.style.getPropertyValue('align-items')).toBe('start')
  }
  const card = rules.find(
    (rule) =>
      'selectorText' in rule &&
      rule.selectorText === '.studio-task-card' &&
      (rule as CSSStyleRule).style.getPropertyValue('max-width') !== '',
  ) as CSSStyleRule
  expect(card.style.getPropertyValue('max-width')).toBe('320px')
  expect(card.style.getPropertyValue('width')).toBe('100%')
  style.remove()
})

it('keeps collection paging inside the chooser and preserves selection while browsing pages', async () => {
  clearAuth()
  const prompt =
    'A quiet garden with morning light and a very long descriptive prompt that stays searchable'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/user/self') return Response.json({ success: false }, { status: 503 })
      return Response.json({ success: true, data: { items: [], total: 0 } })
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['status'], {})
  client.setQueryData(['studio', 'config'], {})
  client.setQueryData(['studio', 'batches', 1], {
    items: [
      { batch_id: 'internal-collection-id', prompt, model: 'image-model', created_at: 1700000000 },
    ],
    total: 101,
  })
  client.setQueryData(['studio', 'batches', 2], {
    items: [{ batch_id: 'other-collection', prompt: 'Another idea', model: 'image-model' }],
    total: 101,
  })
  client.setQueryData(['studio', 'library', '', 'all', 1], { items: [], total: 0 })
  client.setQueryData(['studio', 'library', 'internal-collection-id', 'all', 1], {
    items: [],
    total: 0,
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: LibraryPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  const user = userEvent.setup()
  const trigger = await screen.findByRole('combobox', { name: 'Collection' })
  expect(trigger).toHaveTextContent('All creations')
  expect(screen.queryByRole('navigation', { name: 'Collection' })).not.toBeInTheDocument()
  await user.click(trigger)
  const option = await screen.findByRole('option', { name: /A quiet garden/ })
  expect(option).not.toHaveTextContent('internal-collection-id')
  expect(option).not.toHaveTextContent('stays searchable')
  await user.type(screen.getByRole('combobox', { name: 'Search Collection' }), 'stays searchable')
  expect(screen.getByRole('option', { name: /A quiet garden/ })).toBeVisible()
  await user.click(option)
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  await user.click(trigger)
  await screen.findByRole('navigation', { name: 'Collection' })
  await user.click(
    within(screen.getByRole('navigation', { name: 'Collection' })).getByRole('button', {
      name: 'Next page',
    }),
  )
  expect(await screen.findByRole('option', { name: /Another idea/ })).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Search Collection' })).toHaveFocus()
  expect(trigger).toHaveTextContent('A quiet garden')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('navigation', { name: 'Collection' })).not.toBeInTheDocument()
  expect(trigger).toHaveTextContent('A quiet garden')
  client.clear()
})

it('bounds long collection entries to one line and keeps the list scrollable above its footer', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/features/studio/gallery.css', 'utf8')
  document.head.append(style)
  const rules = Array.from(style.sheet!.cssRules).filter(
    (rule): rule is CSSStyleRule => 'selectorText' in rule,
  )
  const text = rules.find((rule) =>
    rule.selectorText.includes('.collection-picker-popup .search-select-option-copy strong'),
  )!
  expect(text.style.getPropertyValue('white-space')).toBe('nowrap')
  expect(text.style.getPropertyValue('text-overflow')).toBe('ellipsis')
  const list = rules.find(
    (rule) => rule.selectorText === '.collection-picker-popup .search-select-list',
  )!
  expect(Number.parseFloat(list.style.getPropertyValue('min-height'))).toBe(0)
  expect(list.style.getPropertyValue('max-height')).toBe('300px')
  style.remove()
})

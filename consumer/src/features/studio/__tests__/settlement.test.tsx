import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { acceptAuthBundle, clearAuth } from '@/lib/auth-state'
import { CatalogProvider } from '@/lib/catalog'
import { SessionProvider } from '@/lib/session'
import StudioPage from '../StudioPage'
import { readStudioDraft, saveStudioDraft } from '../draft'
import type { StudioTaskPage } from '../contracts'

const queryClients: QueryClient[] = []

beforeEach(() => {
  clearAuth()
  localStorage.clear()
  document.cookie = 'new_api_has_session=1; path=/'
  acceptAuthBundle({
    access_token: 'synthetic-studio-token',
    token_type: 'Bearer',
    access_expires_at: Math.floor(Date.now() / 1000) + 900,
    user: {
      id: 71,
      username: 'studio-test',
      display_name: 'Studio',
      email: '',
      role: 1,
      group: 'default',
      quota: 100000,
      used_quota: 0,
      request_count: 0,
    },
    session: {
      sid: 'studio-session',
      current: true,
      login_method: 'password',
      ip: '127.0.0.1',
      user_agent: 'test',
      created_at: 1,
      last_active_at: 1,
      expires_at: 9999999999,
    },
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  for (const client of queryClients.splice(0)) client.clear()
  vi.unstubAllGlobals()
})

it.each([
  ['completed', 2, 0, 'Your creations are ready.'],
  ['failed', 0, 2, 'Your images could not be created.'],
  ['partial_failure', 1, 1, 'Some images could not be created.'],
])(
  'refreshes settled balances and usage and reports a %s batch accurately',
  async (status, success, failure, heading) => {
    const running: StudioTaskPage = {
      items: [
        {
          id: 1,
          task_id: 'submitted-task',
          group: 'default',
          quota: 0,
          status: 'IN_PROGRESS',
          created_at: 1,
          data: { request: { prompt: 'A quiet garden', model: 'gpt-image-1' } },
        },
      ],
      total: 2,
      page: 1,
      page_size: 60,
      summary: {
        total_count: 2,
        finished_count: 0,
        success_count: 0,
        failure_count: 0,
        queued_count: 1,
        active_count: 1,
      },
    }
    let releaseTasks: (() => void) | undefined
    const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
      const url = new URL(path, 'http://localhost')
      if (url.pathname === '/api/user/self/groups')
        return Response.json({ success: true, data: { default: { desc: 'Everyday', ratio: 1 } } })
      if (url.pathname === '/api/user/models')
        return Response.json({ success: true, data: ['gpt-image-1'] })
      if (url.pathname === '/api/pricing')
        return Response.json({
          success: true,
          data: [
            {
              model_name: 'gpt-image-1',
              supported_endpoint_types: ['image-generation'],
              enable_groups: ['default'],
            },
          ],
          usable_group: { default: 'Everyday' },
          group_ratio: { default: 1 },
        })
      if (url.pathname === '/pg/image-studio/config')
        return Response.json({
          success: true,
          data: { prompt_presets: [], size_presets: [], max_batch_size: 10 },
        })
      if (url.pathname === '/pg/image-studio/estimate')
        return Response.json({
          success: true,
          data: { estimated_quota: 500, resolved_group: 'default' },
        })
      if (url.pathname === '/pg/image-studio/generations') {
        expect(JSON.parse(String(options?.body))).toMatchObject({
          prompt: 'A quiet garden',
          count: 2,
          quality: 'high',
          group: 'default',
        })
        return Response.json({
          success: true,
          data: { batch_id: 'settling-batch', total_count: 2, tasks: running.items },
        })
      }
      if (url.pathname === '/api/image-studio/batches')
        return Response.json({ success: true, data: { items: [], total: 0 } })
      if (url.pathname === '/api/image-studio/batches/settling-batch/tasks')
        return new Promise<Response>((resolve) => {
          releaseTasks = () => resolve(Response.json({ success: true, data: running }))
        })
      if (url.pathname.endsWith('/tasks'))
        return Response.json({ success: true, data: { items: [], total: 0 } })
      if (url.pathname === '/api/user/self')
        return Response.json(
          { success: false, message: 'Read-only balance refresh unavailable' },
          { status: 503 },
        )
      throw new Error(`Unexpected request ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    queryClients.push(client)
    client.setQueryData(['status'], { quota_per_unit: 500000 })
    for (const key of ['usage-logs', 'usage-stats', 'usage-history'])
      client.setQueryData([key], { previous: true })
    client.setQueryData(['studio', 'library'], { previous: true })
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <CatalogProvider>
            <StudioPage />
          </CatalogProvider>
        ),
      }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
    const view = render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Creation settings' })
    expect(screen.getByRole('combobox', { name: 'Service plan' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Image size' })).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: 'Images' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'High' })).toBeVisible()
    if (status === 'completed') {
      expect(screen.getByRole('button', { name: 'Choose reference images' })).toBeVisible()
      expect(
        screen.queryByText('Your draft is saved on this device for this account.'),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Creation help' }))
      expect(await screen.findByRole('dialog', { name: 'Creation help' })).toHaveTextContent(
        'The server reserves an estimate when you submit. Final cost follows actual usage and your service group.',
      )
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Your idea' })).toBeVisible()
    }
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled())
    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    const imageModel = await screen.findByRole('option', { name: 'gpt-image-1' })
    await waitFor(() => expect(imageModel).toBeEnabled())
    await user.click(imageModel)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    if (status === 'completed') {
      const createURL = vi.fn(() => 'blob:synthetic-reference')
      const revokeURL = vi.fn()
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL })
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeURL })
      const prompt = screen.getByRole('textbox', { name: 'Your idea' })
      const form = prompt.closest('form')!
      const image = new File(['synthetic'], 'pasted.png', { type: 'image/png' })
      expect(fireEvent.paste(prompt, { clipboardData: { files: [] } })).toBe(true)
      expect(fireEvent.paste(prompt, { clipboardData: { files: [image] } })).toBe(false)
      expect(await screen.findByRole('img', { name: 'pasted.png' })).toHaveAttribute(
        'src',
        'blob:synthetic-reference',
      )
      expect(fetcher.mock.calls.some(([path]) => path === '/pg/image-studio/edits')).toBe(false)
      await user.click(screen.getByRole('button', { name: 'Remove reference image' }))
      expect(revokeURL).toHaveBeenCalledWith('blob:synthetic-reference')
      const dataTransfer = { types: ['Files'], files: [image] }
      fireEvent.dragEnter(form, { dataTransfer })
      expect(screen.getByText('Drop reference images here')).toBeVisible()
      fireEvent.drop(form, { dataTransfer })
      expect(screen.queryByText('Drop reference images here')).not.toBeInTheDocument()
      expect(await screen.findByRole('img', { name: 'pasted.png' })).toBeVisible()
      fireEvent.drop(form, {
        dataTransfer: {
          types: ['Files'],
          files: [new File(['x'], 'invalid.gif', { type: 'image/gif' })],
        },
      })
      expect(screen.getByText('Only PNG, JPEG, and WebP images are supported.')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Remove reference image' }))
      const oversized = new File(['x'], 'large.png', { type: 'image/png' })
      Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 })
      fireEvent.paste(prompt, { clipboardData: { files: [oversized] } })
      expect(screen.getByText('Each reference image must be 20 MB or smaller.')).toBeVisible()
      expect(screen.queryByRole('img', { name: 'large.png' })).not.toBeInTheDocument()
      const many = Array.from(
        { length: 7 },
        (_, index) => new File(['x'], `reference-${index}.png`, { type: 'image/png' }),
      )
      fireEvent.drop(form, { dataTransfer: { types: ['Files'], files: many } })
      expect(screen.getAllByRole('button', { name: 'Remove reference image' })).toHaveLength(6)
      expect(screen.getByText('Add up to 6 reference images, with 60 MB in total.')).toBeVisible()
      while (screen.queryAllByRole('button', { name: 'Remove reference image' }).length)
        await user.click(screen.getAllByRole('button', { name: 'Remove reference image' })[0]!)
      const large = many.slice(0, 4)
      for (const file of large) Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 })
      fireEvent.drop(form, { dataTransfer: { types: ['Files'], files: large } })
      expect(screen.getAllByRole('button', { name: 'Remove reference image' })).toHaveLength(3)
      expect(screen.getByText('Add up to 6 reference images, with 60 MB in total.')).toBeVisible()
      while (screen.queryAllByRole('button', { name: 'Remove reference image' }).length)
        await user.click(screen.getAllByRole('button', { name: 'Remove reference image' })[0]!)
    }
    await user.click(screen.getByRole('button', { name: 'High' }))
    expect(screen.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Your idea' }), 'A quiet garden')
    expect(screen.getByRole('heading', { name: 'My creations' })).toBeVisible()
    const quoteStatus = screen.getByTestId('studio-quote-status')
    await user.click(screen.getByRole('button', { name: '4 images' }))
    expect(quoteStatus).toHaveTextContent('Calculating…')
    expect(screen.getByRole('button', { name: 'Create images' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'Images' })).toHaveValue(4)
    await user.click(screen.getByRole('button', { name: '2 images' }))
    expect(screen.getByRole('spinbutton', { name: 'Images' })).toHaveValue(2)
    expect(screen.getByText('2 images')).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create images' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Create images' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Your idea' })).toHaveValue(''))
    expect(screen.getByRole('combobox', { name: 'Collection' })).toHaveTextContent('All creations')
    await act(async () => router.navigate({ to: '/', search: { batch: 'settling-batch' } }))
    await screen.findByRole('heading', { name: 'Your idea is taking shape.' })
    expect(screen.getByRole('textbox', { name: 'Your idea' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'View creation' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'View creation' }))
    expect(await screen.findByRole('dialog', { name: 'Creation details' })).toHaveTextContent(
      'A quiet garden',
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('textbox', { name: 'Your idea' })).toHaveValue('')
    // Returned tasks are already visible while the authoritative listing is still loading.
    await act(async () => releaseTasks?.())
    expect(screen.queryByRole('link', { name: 'Open my creations' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([path]) => path === '/api/user/self')).toHaveLength(1),
    )
    await act(async () => {
      client.setQueryData(['studio', 'library', 'settling-batch', 'all', 1], {
        ...running,
        items: running.items.map((task) => ({ ...task, status: failure ? 'FAILURE' : 'SUCCESS' })),
        summary: {
          ...running.summary,
          active_count: 0,
          queued_count: 0,
          success_count: success,
          failure_count: failure,
          finished_count: success + failure,
        },
      })
    })
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([path]) => path === '/api/user/self')).toHaveLength(2),
    )
    for (const key of ['usage-logs', 'usage-stats', 'usage-history'])
      expect(client.getQueryState([key])?.isInvalidated).toBe(true)
    expect(
      fetcher.mock.calls.filter(([path]) => path === '/pg/image-studio/generations'),
    ).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      fetcher.mock.calls.some(([path]) => path === '/api/image-studio/batches/settling-batch'),
    ).toBe(false)
    if (failure > 0) expect(screen.getByRole('button', { name: 'Failed' })).toBeEnabled()
    await act(async () => {
      client.setQueryData<StudioTaskPage>(
        ['studio', 'library', 'settling-batch', 'all', 1],
        (current) => current && { ...current, page: 1 },
      )
      await i18n.changeLanguage('fr')
    })
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/user/self')).toHaveLength(2)
    // Deleting settled tasks changes the visible collection, not its historical progress.
    await act(async () => {
      client.setQueryData<StudioTaskPage>(
        ['studio', 'library', 'settling-batch', 'all', 1],
        (current) =>
          current && {
            ...current,
            items: [],
            total: 0,
            summary: {
              ...current.summary!,
              success_count: 0,
              failure_count: 0,
              deleted_count: 2,
            },
          },
      )
    })
    expect(
      await screen.findByRole('heading', {
        name: 'All creations in this collection were deleted.',
      }),
    ).toBeVisible()
    expect(screen.getByText('0 creations')).toBeVisible()
    expect(
      screen.getByText('2 deleted tasks are included in the original batch progress.'),
    ).toBeVisible()
    expect(screen.getByText('2 of 2 finished')).toBeVisible()
    expect(screen.queryByRole('progressbar', { name: 'Batch progress' })).not.toBeInTheDocument()
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/user/self')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('textbox', { name: 'Your idea' })).toHaveValue('')
    expect(JSON.parse(localStorage.getItem('factory:studio:71:draft') || '{}')).toMatchObject({
      prompt: '',
      count: 2,
      model: 'gpt-image-1',
      group: 'default',
    })
    view.unmount()
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    expect(await screen.findByRole('textbox', { name: 'Your idea' })).toHaveValue('')
    expect(screen.getByRole('spinbutton', { name: 'Images' })).toHaveValue(2)
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('gpt-image-1'),
    )
    expect(
      fetcher.mock.calls.filter(([path]) => path === '/pg/image-studio/generations'),
    ).toHaveLength(1)
    client.clear()
  },
  15_000,
)

it.each(['rejected', 'unclear', 'accepted with a new idea'])(
  'preserves the current idea when submission is %s',
  async (outcome) => {
    saveStudioDraft(71, {
      prompt: 'A quiet garden',
      group: 'default',
      model: 'gpt-image-1',
      count: 2,
      size: '',
      quality: 'high',
      needsReferences: false,
    })
    let resolveSubmission: (response: Response) => void = () => {
      throw new Error('Submission has not started')
    }
    const fetcher = vi.fn(async (path: string) => {
      if (path === '/pg/image-studio/generations')
        return new Promise<Response>((resolve) => {
          resolveSubmission = resolve
        })
      if (path.startsWith('/pg/image-studio/estimate'))
        return Response.json({
          success: true,
          data: { estimated_quota: 500, resolved_group: 'default' },
        })
      if (path === '/api/user/self') return Response.json({ success: false }, { status: 503 })
      if (path.startsWith('/api/image-studio/batches?'))
        return Response.json({
          success: true,
          data: {
            items: [
              {
                batch_id: 'existing-collection',
                prompt: 'Existing collection',
                model: 'gpt-image-1',
                status: 'completed',
              },
            ],
            total: 1,
          },
        })
      if (path.startsWith('/api/image-studio/'))
        return Response.json({ success: true, data: { items: [], total: 0 } })
      throw new Error(`Unexpected request ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    queryClients.push(client)
    client.setQueryData(['status'], { quota_per_unit: 500000 })
    client.setQueryData(['catalog', 71], {
      data: [
        {
          model_name: 'gpt-image-1',
          supported_endpoint_types: ['image-generation'],
          enable_groups: ['default'],
        },
      ],
      usable_group: { default: 'Everyday' },
      group_ratio: { default: 1 },
    })
    client.setQueryData(['service-groups', 71], { default: { desc: 'Everyday', ratio: 1 } })
    client.setQueryData(['allowed-models', 71, 'default'], ['gpt-image-1'])
    client.setQueryData(['studio', 'config'], {
      prompt_presets: [],
      size_presets: [],
      max_batch_size: 10,
    })
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <CatalogProvider>
            <StudioPage />
          </CatalogProvider>
        ),
      }),
      history: createMemoryHistory({ initialEntries: ['/?batch=existing-collection'] }),
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
    const prompt = await screen.findByRole('textbox', { name: 'Your idea' })
    const create = screen.getByRole('button', { name: 'Create images' })
    await waitFor(() => expect(create).toBeEnabled())
    await user.click(create)
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([path]) => path === '/pg/image-studio/generations'),
      ).toHaveLength(1),
    )
    expect(prompt).toHaveValue('A quiet garden')
    expect(create).toBeDisabled()
    let expectedPrompt = 'A quiet garden'
    if (outcome === 'accepted with a new idea') {
      expectedPrompt = 'A new seaside sketch'
      await user.clear(prompt)
      await user.type(prompt, expectedPrompt)
    }
    await act(async () => {
      let response = Response.json(
        { success: false, message: 'Submission unavailable' },
        { status: 503 },
      )
      if (outcome === 'unclear') response = Response.json({ success: true, data: {} })
      if (outcome === 'accepted with a new idea')
        response = Response.json({
          success: true,
          data: { batch_id: 'new-batch', tasks: [], total_count: 2 },
        })
      resolveSubmission(response)
    })
    if (outcome === 'rejected') await screen.findByText('Submission unavailable')
    else if (outcome === 'unclear')
      await screen.findByText(
        'The submission result is unclear. Check your library before trying again.',
      )
    else await waitFor(() => expect(create).toBeEnabled())
    expect(screen.getByRole('combobox', { name: 'Collection' })).toHaveTextContent(
      'Existing collection',
    )
    expect(router.state.location.search).toEqual({ batch: 'existing-collection' })
    expect(prompt).toHaveValue(expectedPrompt)
    expect(readStudioDraft(71)).toMatchObject({ prompt: expectedPrompt, count: 2, quality: 'high' })
    expect(
      fetcher.mock.calls.filter(([path]) => path === '/pg/image-studio/generations'),
    ).toHaveLength(1)
  },
)

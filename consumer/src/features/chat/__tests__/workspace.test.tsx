import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ChatPage from '../ChatPage'
import { supportsKind } from '@/components/service-picker'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/api', () => ({ authorizedFetch: mocks.fetch }))
vi.mock('@/lib/catalog', () => ({ useCatalog: () => ({ group: 'default' }) }))
vi.mock('@/lib/session', () => ({
  useSession: () => ({ user: { id: 987 }, refreshUser: mocks.refresh }),
}))
vi.mock('@/lib/use-preferred-model', () => ({ usePreferredModel: () => ['vision-chat', vi.fn()] }))
vi.mock('../ChatModelPicker', () => ({ ChatModelPicker: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const clients: QueryClient[] = []
function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(['status'], { system_name: 'Example AI' })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <ChatPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mocks.fetch.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  for (const client of clients.splice(0)) client.clear()
})

it('excludes image generation including legacy image models while retaining vision chat', () => {
  expect(
    supportsKind({ model_name: 'gpt-image-2', supported_endpoint_types: ['openai'] }, 'chat'),
  ).toBe(false)
  expect(
    supportsKind(
      { model_name: 'custom-image', supported_endpoint_types: ['openai', 'image-generation'] },
      'chat',
    ),
  ).toBe(false)
  expect(supportsKind({ model_name: 'gpt-4o', supported_endpoint_types: ['openai'] }, 'chat')).toBe(
    true,
  )
})

it('allows two conversations to stream independently and aborts only the selected request', async () => {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = []
  mocks.fetch.mockImplementation(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            streams.push(controller)
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    ),
  )
  const view = renderWorkspace()
  const input = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: 'First question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getAllByRole('button', { name: 'New conversation' })[0]!)
  fireEvent.change(input, { target: { value: 'Second question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2))
  await act(async () => {
    streams[0]!.enqueue(
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"First answer"}}]}\n\n'),
    )
  })
  expect(screen.queryByText('First answer')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /First question.*Responding/ }))
  expect(screen.getByText('First answer')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Stop response' }))
  expect(screen.getByRole('button', { name: 'Edit message' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Edit message' })).toHaveAttribute(
    'title',
    'Stop the response before editing messages.',
  )
  expect(mocks.fetch.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(mocks.fetch.mock.calls[1]![1].signal.aborted).toBe(false)
  view.unmount()
  expect(mocks.fetch.mock.calls[1]![1].signal.aborted).toBe(true)
  expect(localStorage.getItem('new-api-consumer:chat:v1:987')).toContain('First answer')
  expect(localStorage.getItem('new-api-consumer:chat:v1:987')).not.toContain('streaming')
})

it('previews pasted and dropped images without swallowing ordinary text paste', async () => {
  renderWorkspace()
  const input = screen.getByRole('textbox', { name: 'Message' })
  const plain = fireEvent.paste(input, {
    clipboardData: { items: [], getData: () => 'normal text' },
  })
  expect(plain).toBe(true)
  const file = new File(['png'], 'clipboard.png', { type: 'image/png' })
  fireEvent.paste(input, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      getData: () => '',
    },
  })
  expect(await screen.findByRole('img', { name: 'clipboard.png' })).toHaveAttribute(
    'src',
    expect.stringContaining('data:image/png'),
  )
  fireEvent.drop(input.closest('form')!, {
    dataTransfer: { files: [new File(['png'], 'dropped.png', { type: 'image/png' })] },
  })
  expect(await screen.findByRole('img', { name: 'dropped.png' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
  expect(screen.queryByRole('img', { name: 'dropped.png' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
})

it('keeps the draft and composer when focusing the workspace and offers attachment guidance', () => {
  renderWorkspace()
  const input = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.click(screen.getByRole('button', { name: 'Make a plan' }))
  expect(input).toHaveValue('Help me turn a rough idea into a clear action plan.')
  expect(input).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Hide conversations' }))
  expect(screen.queryByRole('complementary', { name: 'Conversations' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input)
  fireEvent.click(screen.getByRole('button', { name: 'Show conversations' }))
  expect(input).toHaveValue('Help me turn a rough idea into a clear action plan.')
  fireEvent.click(screen.getByRole('button', { name: 'Attachment help' }))
  expect(screen.getByRole('dialog', { name: 'Images and files' })).toHaveTextContent(
    'Paste an image, drag a file, or use the plus button to attach it.',
  )
})

it('keeps conversation actions reachable without starting another billed request', async () => {
  mocks.fetch.mockResolvedValue(
    new Response('data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }),
  )
  renderWorkspace()
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'My question' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Stop response' })).not.toBeInTheDocument(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Conversation options' }))
  expect(screen.getByRole('dialog', { name: 'Conversation options' })).toHaveTextContent(
    'My question',
  )
  expect(screen.getByRole('button', { name: 'Export conversation as Markdown' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Back up local conversations' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Rename conversation' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Renamed locally' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('button', { name: 'Renamed locally' })).toBeInTheDocument()
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
})

it('checkpoints a background response while it streams and saves the latest text on leaving', async () => {
  vi.useFakeTimers()
  let stream: ReadableStreamDefaultController<Uint8Array>
  mocks.fetch.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          stream = controller
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    ),
  )
  const view = renderWorkspace()
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Background question' },
  })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })))
  fireEvent.click(screen.getAllByRole('button', { name: 'New conversation' })[0]!)
  await act(async () => {
    stream.enqueue(
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"First part"}}]}\n\n'),
    )
  })
  const historyKey = 'new-api-consumer:chat:v1:987'
  expect(localStorage.getItem(historyKey)).not.toContain('First part')
  await act(async () => vi.advanceTimersByTimeAsync(400))
  await act(async () => {
    stream.enqueue(
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":" and second"}}]}\n\n'),
    )
  })
  await act(async () => vi.advanceTimersByTimeAsync(100))
  expect(localStorage.getItem(historyKey)).toContain('First part and second')
  expect(screen.queryByText('First part and second')).not.toBeInTheDocument()
  await act(async () => {
    stream.enqueue(
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":" before leaving"}}]}\n\n'),
    )
  })
  view.unmount()
  expect(localStorage.getItem(historyKey)).toContain('First part and second before leaving')
  expect(localStorage.getItem(historyKey)).not.toContain('streaming')
})

it('edits a prior user turn only on resend, retaining history on cancel and truncating later turns', async () => {
  localStorage.setItem(
    'new-api-consumer:chat:v1:987',
    JSON.stringify([
      {
        id: 'edit-chat',
        title: 'Original title',
        updatedAt: 1,
        messages: [
          {
            id: 'first',
            role: 'user',
            content: 'Original question\n\n[notes.txt]\nKeep these notes',
            status: 'complete',
          },
          { id: 'answer', role: 'assistant', content: 'Old answer', status: 'complete' },
          { id: 'later', role: 'user', content: 'Later question', status: 'complete' },
        ],
      },
    ]),
  )
  localStorage.setItem(
    'factory:chat-workspace:v1:987',
    JSON.stringify({ activeId: 'edit-chat', drafts: { 'edit-chat': 'Unsent draft' } }),
  )
  mocks.fetch.mockResolvedValue(
    new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  )
  renderWorkspace()
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit message' })[0]!)
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), {
    target: { value: 'Discarded edit' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('Old answer')).toBeInTheDocument()
  expect(mocks.fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit message' })[0]!)
  expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue(
    'Original question\n\n[notes.txt]\nKeep these notes',
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), {
    target: { value: 'Updated question\n\n[notes.txt]\nKeep these notes' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and resend' }))
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
  const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body)
  expect(body).toMatchObject({
    model: 'vision-chat',
    group: 'default',
    messages: [{ role: 'user', content: 'Updated question\n\n[notes.txt]\nKeep these notes' }],
  })
  expect(body.messages).toHaveLength(1)
  expect(screen.queryByText('Old answer')).not.toBeInTheDocument()
  expect(screen.queryByText('Later question')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Unsent draft')
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem('new-api-consumer:chat:v1:987')!)[0]).toMatchObject({
      id: 'edit-chat',
      title: 'Original title',
    }),
  )
})

it('retains a session image when editing and resending its user message', async () => {
  mocks.fetch.mockImplementation(() =>
    Promise.resolve(
      new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    ),
  )
  renderWorkspace()
  const input = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.paste(input, {
    clipboardData: {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => new File(['png'], 'image.png', { type: 'image/png' }),
        },
      ],
      getData: () => '',
    },
  })
  await screen.findByRole('img', { name: 'image.png' })
  fireEvent.change(input, { target: { value: 'Describe it' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit message' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), {
    target: { value: 'Explain its colors' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and resend' }))
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2))
  const original = JSON.parse(mocks.fetch.mock.calls[0]![1].body)
  const edited = JSON.parse(mocks.fetch.mock.calls[1]![1].body)
  expect(edited.messages).toEqual([
    {
      role: 'user',
      content: [{ type: 'text', text: 'Explain its colors' }, original.messages[0].content[1]],
    },
  ])
})

it('blocks resending an edited message whose image was not saved in browser history', async () => {
  localStorage.setItem(
    'new-api-consumer:chat:v1:987',
    JSON.stringify([
      {
        id: 'image-chat',
        title: 'Image question',
        updatedAt: 1,
        messages: [
          {
            id: 'image-user',
            role: 'user',
            content: 'Describe the image',
            imageName: 'original.png',
            status: 'complete',
          },
          {
            id: 'image-answer',
            role: 'assistant',
            content: 'Keep this answer',
            status: 'complete',
          },
        ],
      },
    ]),
  )
  localStorage.setItem(
    'factory:chat-workspace:v1:987',
    JSON.stringify({ activeId: 'image-chat', drafts: {} }),
  )
  renderWorkspace()
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
  const editor = screen.getByRole('textbox', { name: 'Edit message' })
  expect(editor).toHaveFocus()
  fireEvent.change(editor, { target: { value: '   ' } })
  expect(screen.getByRole('button', { name: 'Save and resend' })).toBeDisabled()
  fireEvent.change(editor, { target: { value: 'Updated image question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and resend' }))
  expect(screen.getByRole('dialog', { name: 'Edit message' })).toHaveTextContent(
    'An image is missing from local history.',
  )
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(screen.getByText('Keep this answer')).toBeInTheDocument()
})

import { render, screen, fireEvent } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { MessageView } from '../MessageView'
import { ConversationList } from '../ConversationList'
import type { ChatMessage } from '../history'

async function renderMessage(message: ChatMessage) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <MessageView message={message} />
    </I18nextProvider>,
  )
}

describe('chat message rendering', () => {
  it('renders model images as explicit links without automatically loading remote tracking images', async () => {
    await renderMessage({
      id: 'assistant',
      role: 'assistant',
      content: '![A landscape](https://images.example.test/view.png)',
      status: 'complete',
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'A landscape' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    )
  })

  it('preserves a partial stopped response and clearly states it may still be billed', async () => {
    await renderMessage({
      id: 'assistant',
      role: 'assistant',
      content: '**A useful start**',
      status: 'stopped',
    })
    expect(screen.getByText('A useful start').tagName).toBe('STRONG')
    expect(
      screen.getByText('Response stopped. Partial responses may still be billed.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument()
  })

  it('does not execute or display assistant supplied raw HTML', async () => {
    await renderMessage({
      id: 'assistant',
      role: 'assistant',
      content: '<script>alert("secret")</script>\n\nA safe answer',
      status: 'complete',
    })
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText('A safe answer')).toBeInTheDocument()
  })
})

it('labels finished reasoning as a completed thinking process', async () => {
  await renderMessage({
    id: 'r',
    role: 'assistant',
    content: 'Answer',
    reasoning: 'Reason',
    status: 'complete',
  })
  expect(screen.getByText('Thinking process')).toBeInTheDocument()
  expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
})
it('offers a separate copy control for fenced code', async () => {
  await renderMessage({
    id: 'c',
    role: 'assistant',
    content: '```js\nconsole.log(1)\n```',
    status: 'complete',
  })
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
})

it('shows active thinking only before answer text starts arriving', async () => {
  await renderMessage({
    id: 'r',
    role: 'assistant',
    content: 'Answer is arriving',
    reasoning: 'Reason',
    status: 'streaming',
  })
  expect(screen.getByText('Thinking process')).toBeInTheDocument()
  expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
})

it('searches conversation message contents and shows an empty result clearly', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <ConversationList
        conversations={[
          {
            id: 'c',
            title: 'Homework',
            updatedAt: 1,
            messages: [
              { id: 'u', role: 'user', content: 'Photosynthesis question', status: 'complete' },
            ],
          },
        ]}
        activeId={null}
        disabled={false}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />
    </I18nextProvider>,
  )
  const search = screen.getByRole('textbox', { name: 'Search conversations' })
  fireEvent.change(search, { target: { value: 'photosynthesis' } })
  expect(screen.getByRole('button', { name: 'Homework' })).toBeInTheDocument()
  fireEvent.change(search, { target: { value: 'missing subject' } })
  expect(screen.queryByRole('button', { name: 'Homework' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('No matching conversations')
})

it('copies only fenced code when using its own copy control', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await renderMessage({
    id: 'c',
    role: 'assistant',
    content: 'Explanation\n\n```js\nconsole.log(1)\n```',
    status: 'complete',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
  expect(writeText).toHaveBeenCalledWith('console.log(1)')
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { TaskCard } from '../TaskCard'
import type { StudioTask } from '../contracts'

const task: StudioTask = {
  id: 1,
  task_id: 'task-one',
  group: 'everyday',
  quota: 500,
  status: 'SUCCESS',
  created_at: 1,
  data: {
    request: { prompt: 'A quiet garden', model: 'image-model' },
    response: { data: [{ url: '/api/image-studio/assets/1/2/signed', asset_status: 'ready' }] },
  },
}

async function renderTask(value: StudioTask, selected = false) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['status'], { quota_per_unit: 500000 })
  const onSelect = vi.fn()
  const onPreview = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <TaskCard task={value} selected={selected} onSelect={onSelect} onPreview={onPreview} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { onSelect, onPreview }
}

describe('creation gallery actions', () => {
  it('allows selecting and opening a completed creation with an accessible image', async () => {
    const actions = await renderTask(task)
    expect(screen.getByRole('img', { name: 'A quiet garden' })).toHaveAttribute(
      'referrerpolicy',
      'no-referrer',
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select image task' }))
    fireEvent.click(screen.getByRole('button', { name: 'View creation' }))
    expect(actions.onSelect).toHaveBeenCalledOnce()
    expect(actions.onPreview).toHaveBeenCalledOnce()
  })

  it('opens a creation with Enter on the image surface without selecting its checkbox', async () => {
    const actions = await renderTask(task)
    const user = userEvent.setup()
    const open = screen.getByRole('button', { name: 'View creation' })
    expect(open).toHaveClass('studio-image-open')
    open.focus()
    await user.keyboard('{Enter}')
    expect(actions.onPreview).toHaveBeenCalledOnce()
    expect(actions.onSelect).not.toHaveBeenCalled()
  })

  it('keeps running tasks visible but disables destructive selection', async () => {
    const actions = await renderTask({
      ...task,
      status: 'IN_PROGRESS',
      data: { request: { prompt: 'A quiet garden' } },
    })
    const checkbox = screen.getByRole('checkbox', { name: 'Select image task' })
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(checkbox)
    expect(screen.getAllByText('Creating')).toHaveLength(2)
    expect(actions.onSelect).not.toHaveBeenCalled()
  })

  it('shows unavailable state instead of a broken image when the asset has expired', async () => {
    await renderTask(
      {
        ...task,
        data: {
          request: { prompt: 'A quiet garden' },
          response: { data: [{ asset_status: 'expired' }] },
        },
      },
      true,
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Image unavailable')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select image task' })).toBeChecked()
  })
})

it('makes multiple assets in one historical task visible on the image card', async () => {
  await renderTask({
    ...task,
    data: {
      request: { prompt: 'Multiple assets' },
      response: {
        data: [
          { url: '/api/image-studio/assets/1/2/signed', asset_status: 'ready' },
          { url: '/api/image-studio/assets/2/2/signed', asset_status: 'ready' },
        ],
      },
    },
  })
  expect(screen.getByText('2 images')).toBeVisible()
})

it('shows the generation completion time on the card', async () => {
  await renderTask({
    ...task,
    created_at: 1699999970,
    submit_time: 1699999970,
    start_time: 1700000000,
    finish_time: 1700000018,
  })
  const time = screen.getByRole('time')
  expect(time).toHaveAttribute('datetime', '2023-11-14T22:13:38.000Z')
  expect(time).toHaveAccessibleName(/^Generated at:/)
  const duration = screen.getByTitle('Generation duration: 18 s')
  expect(duration).toBeVisible()
  expect(duration).toHaveTextContent('18s')
  expect(screen.queryByText('Generation duration: 18 s')).not.toBeInTheDocument()
})

it('uses submission time for an unfinished creation instead of a stale finish timestamp', async () => {
  await renderTask({
    ...task,
    status: 'IN_PROGRESS',
    submit_time: 1700000000,
    finish_time: 1700000018,
  })
  expect(screen.getByRole('time')).toHaveAttribute('datetime', '2023-11-14T22:13:20.000Z')
  expect(screen.getByRole('time')).toHaveAccessibleName(/^Submitted at:/)
  expect(screen.queryByText(/Generation duration:/)).not.toBeInTheDocument()
})

it('omits invalid and missing timestamps instead of displaying a misleading date', async () => {
  await renderTask({ ...task, created_at: 0, submit_time: -1, finish_time: Number.NaN })
  expect(screen.queryByRole('time')).not.toBeInTheDocument()
  expect(screen.queryByText(/Not recorded/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'View creation' })).toBeEnabled()
})

it('shows sub-second completion without claiming generation took zero seconds', async () => {
  await renderTask({ ...task, start_time: 1700000000, finish_time: 1700000000 })
  expect(screen.getByTitle('Generation duration: Less than 1 s')).toHaveTextContent('<1s')
})

it('does not calculate a negative duration from inconsistent timestamps', async () => {
  await renderTask({ ...task, start_time: 1700000018, finish_time: 1700000000 })
  expect(screen.queryByText(/Not recorded/)).not.toBeInTheDocument()
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
beforeEach(async () => {
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } })
})
import { DateTimePicker } from '../date-time-picker'

it('keeps a custom draft unchanged on cancel and rejects empty dates', async () => {
  const change = vi.fn()
  render(
    <DateTimePicker
      label="Range date"
      triggerLabel="Custom date"
      value=""
      onChange={change}
      allowClear
    />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Range date' }))
  await user.click(screen.getByRole('button', { name: 'Apply date' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose a valid date and time within the allowed range.',
  )
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(change).not.toHaveBeenCalled()
})

it('applies a selected calendar date only after explicit confirmation', async () => {
  const change = vi.fn()
  const future = new Date()
  future.setDate(future.getDate() + 2)
  future.setHours(12, 34, 0, 0)
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000)
  render(
    <DateTimePicker
      label="Range date"
      triggerLabel="Custom date"
      value={local.toISOString().slice(0, 16)}
      onChange={change}
    />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Range date' }))
  expect(screen.getByRole('grid')).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Time' })).toHaveTextContent('12:34')
  expect(change).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Apply date' }))
  expect(change).toHaveBeenCalledWith(local.toISOString().slice(0, 16))
})

it('clears only through the explicit clear action and preserves a historical value', async () => {
  const change = vi.fn()
  render(
    <DateTimePicker label="Range date" value="2020-01-05T12:34" onChange={change} allowClear />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Range date' }))
  expect(screen.getByRole('combobox', { name: 'Time' })).toHaveTextContent('12:34')
  await user.click(screen.getByRole('button', { name: 'Apply date' }))
  expect(change).toHaveBeenLastCalledWith('2020-01-05T12:34')
  await user.click(screen.getByRole('button', { name: 'Range date' }))
  await user.click(screen.getByRole('button', { name: 'Clear date' }))
  expect(change).toHaveBeenLastCalledWith('')
})

it('rejects a selected time outside the allowed range', async () => {
  const change = vi.fn()
  render(
    <DateTimePicker
      label="Range date"
      value="2020-01-05T12:34"
      min="2020-01-05T13:00"
      max="2020-01-06T00:00"
      onChange={change}
    />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Range date' }))
  await user.click(screen.getByRole('button', { name: 'Apply date' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(change).not.toHaveBeenCalled()
})

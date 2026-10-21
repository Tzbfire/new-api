import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
beforeEach(async () => {
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } })
})
import { KeyExpiration } from '../KeyExpiration'

it('offers finite presets and removes expiry without submitting a parent form', async () => {
  const change = vi.fn()
  const submit = vi.fn()
  render(
    <form onSubmit={submit}>
      <KeyExpiration value="" onChange={change} />
    </form>,
  )
  const user = userEvent.setup()
  const before = Date.now()
  await user.click(screen.getByRole('button', { name: '7 days' }))
  const chosen = new Date(change.mock.calls[0][0]).getTime()
  expect(chosen).toBeGreaterThan(before + 6 * 86400000)
  expect(chosen).toBeLessThan(before + 8 * 86400000)
  await user.click(screen.getByRole('button', { name: 'Never' }))
  expect(change).toHaveBeenLastCalledWith('')
  expect(submit).not.toHaveBeenCalled()
})

it('keeps a custom draft unchanged on cancel and rejects empty dates', async () => {
  const change = vi.fn()
  render(<KeyExpiration value="" onChange={change} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Expiration time' }))
  await user.click(screen.getByRole('button', { name: 'Apply date' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose an expiration time in the future.',
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
  render(<KeyExpiration value={local.toISOString().slice(0, 16)} onChange={change} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Expiration time' }))
  expect(screen.getByRole('grid')).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Time' })).toHaveTextContent('12:34')
  expect(change).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Apply date' }))
  expect(change).toHaveBeenCalledWith(local.toISOString().slice(0, 16))
})

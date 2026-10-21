import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { SearchSelect } from '../search-select'
import { Pagination } from '../pagination'
import { Preferences } from '../preferences'
import { Checkbox, Field, Select } from '../ui'

afterEach(() => vi.unstubAllGlobals())

async function show(element: React.ReactNode) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  return render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>)
}

function Picker() {
  const [value, setValue] = useState('one')
  return (
    <SearchSelect
      label="Model"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'one', label: 'Everyday model', description: 'Fast and light' },
        { value: 'two', label: 'Creative model', description: 'For longer writing' },
      ]}
    />
  )
}

it('searches labels and descriptions, selects with keyboard, and returns focus on close', async () => {
  await show(<Picker />)
  const user = userEvent.setup()
  const trigger = screen.getByRole('combobox', { name: 'Model' })
  await user.click(trigger)
  await user.type(await screen.findByRole('combobox', { name: 'Search Model' }), 'longer')
  expect(await screen.findByRole('option', { name: /Creative model/ })).toBeVisible()
  expect(screen.queryByRole('option', { name: /Everyday model/ })).not.toBeInTheDocument()
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(trigger).toHaveTextContent('Creative model'))
  await waitFor(() => expect(trigger).toHaveFocus())
  await user.click(trigger)
  await user.type(await screen.findByRole('combobox', { name: 'Search Model' }), 'missing')
  expect(await screen.findByText('No matching options')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(trigger).toHaveTextContent('Creative model')
})

function Pages() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(15)
  return (
    <>
      <output>
        {page}:{size}
      </output>
      <Pagination
        page={page}
        pageSize={size}
        total={200}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPage(1)
          setSize(value)
        }}
      />
    </>
  )
}

it('supports direct page navigation and rejects out-of-range jumps', async () => {
  await show(<Pages />)
  const user = userEvent.setup()
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Page 2' }))
  await user.click(screen.getByRole('button', { name: 'Page 3' }))
  expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page')
  await user.clear(screen.getByRole('spinbutton', { name: 'Go to page' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Go to page' }), '99{Enter}')
  expect(screen.getByRole('status')).toHaveTextContent('3:15')
  await user.clear(screen.getByRole('spinbutton', { name: 'Go to page' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Go to page' }), '14{Enter}')
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  await user.click(screen.getByRole('combobox', { name: 'Rows per page' }))
  await user.click(await screen.findByRole('option', { name: '30' }))
  expect(screen.getByRole('status')).toHaveTextContent('1:30')
})

it('keeps mobile and desktop appearance controls in sync and restores the system theme', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
  localStorage.removeItem('new-api-consumer:theme')
  await show(
    <>
      <Preferences />
      <Preferences />
    </>,
  )
  const user = userEvent.setup()
  const triggers = screen.getAllByRole('button', { name: 'Appearance and language' })
  await user.click(triggers[1]!)
  await user.click(screen.getByRole('combobox', { name: 'Appearance' }))
  await user.click(await screen.findByRole('option', { name: 'Dark' }))
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  expect(document.documentElement.dataset.theme).toBe('dark')
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(triggers[0]!)
  expect(screen.getByRole('combobox', { name: 'Appearance' })).toHaveTextContent('Dark')
  await user.click(screen.getByRole('combobox', { name: 'Appearance' }))
  await user.click(await screen.findByRole('option', { name: 'Follow system' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('new-api-consumer:theme')).toBe('system')
})

function FormControls() {
  const [value, setValue] = useState('a')
  const [checked, setChecked] = useState(false)
  return (
    <>
      <Field label="Quality" hint="Choose a quality" error="Check your choice">
        <Select
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'a', label: 'Standard' },
            { value: 'b', label: 'High' },
            { value: 'c', label: 'Unavailable', disabled: true },
          ]}
        />
      </Field>
      <label>
        <Checkbox checked={checked} onCheckedChange={setChecked} />
        Use a budget limit
      </label>
      <Checkbox aria-label="Locked setting" disabled checked />
    </>
  )
}

it('uses accessible shared controls with keyboard selection, focus return, validation and disabled states', async () => {
  await show(<FormControls />)
  const user = userEvent.setup()
  const select = screen.getByRole('combobox', { name: 'Quality' })
  expect(select).toHaveAccessibleDescription('Choose a quality Check your choice')
  expect(select).toHaveAttribute('aria-invalid', 'true')
  await user.click(select)
  expect(await screen.findByRole('option', { name: 'Unavailable' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await waitFor(() => expect(screen.getByRole('option', { name: 'Standard' })).toHaveFocus())
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(select).toHaveTextContent('High'))
  await waitFor(() => expect(select).toHaveFocus())
  await user.tab()
  await user.keyboard(' ')
  expect(screen.getByRole('checkbox', { name: 'Use a budget limit' })).toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'Locked setting' }))
  expect(screen.getByRole('checkbox', { name: 'Locked setting' })).toBeChecked()
})

it('keeps required checkbox form validation and excludes disabled fields', async () => {
  const { rerender } = await show(
    <form aria-label="Terms">
      <label>
        <Checkbox required name="terms" />
        Accept terms
      </label>
    </form>,
  )
  const form = screen.getByRole('form', { name: 'Terms' }) as HTMLFormElement
  expect(form.checkValidity()).toBe(false)
  await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Accept terms' }))
  expect(form.checkValidity()).toBe(true)
  expect(new FormData(form).get('terms')).toBe('on')
  rerender(
    <form aria-label="Terms">
      <label>
        <Checkbox required name="terms" checked={false} disabled />
        Accept terms
      </label>
    </form>,
  )
  const disabledForm = screen.getByRole('form', { name: 'Terms' }) as HTMLFormElement
  expect(disabledForm.checkValidity()).toBe(true)
  expect(new FormData(disabledForm).has('terms')).toBe(false)
})

it('disables every pagination action while a page request is pending', async () => {
  const onPageChange = vi.fn()
  const onPageSizeChange = vi.fn()
  await show(
    <Pagination
      page={2}
      pageSize={15}
      total={100}
      disabled
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />,
  )
  const user = userEvent.setup()
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  expect(screen.getByRole('spinbutton', { name: 'Go to page' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Page 3' }))
  expect(onPageChange).not.toHaveBeenCalled()
  expect(onPageSizeChange).not.toHaveBeenCalled()
})

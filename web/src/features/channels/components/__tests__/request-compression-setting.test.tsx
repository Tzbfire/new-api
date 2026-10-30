/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { describe, expect, test } from 'vitest'

import { Form } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

import {
  CHANNEL_FORM_DEFAULT_VALUES,
  transformChannelToFormDefaults,
  transformFormDataToCreatePayload,
  transformFormDataToUpdatePayload,
  type ChannelFormValues,
} from '../../lib/channel-form'
import { channelSchema } from '../../types'
import { RequestCompressionSetting } from '../request-compression-setting'

const label = 'Compress upstream JSON requests'

function SettingsForm(props: {
  headers?: string
  disabled?: boolean
  onSave: (values: ChannelFormValues) => void
}) {
  const form = useForm<ChannelFormValues>({
    defaultValues: {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      header_override: props.headers ?? '',
    },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(props.onSave)}>
        <RequestCompressionSetting disabled={props.disabled} />
        <Textarea
          aria-label='Header overrides'
          {...form.register('header_override')}
        />
        <button type='submit'>Save</button>
      </form>
    </Form>
  )
}

describe('Request compression channel setting', () => {
  test('clicking on and using the keyboard to turn off preserves unrelated header rules', async () => {
    const user = userEvent.setup()
    const saved: ChannelFormValues[] = []
    render(
      <SettingsForm
        headers='{"X-Trace":"keep","*":true}'
        onSave={(value) => saved.push(value)}
      />
    )
    const toggle = screen.getByRole('switch', { name: label })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(JSON.parse(saved[0].header_override ?? '')).toEqual({
      'X-Trace': 'keep',
      '*': true,
      'Content-Encoding': 'gzip',
    })
    toggle.focus()
    await user.keyboard(' ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(JSON.parse(saved[1].header_override ?? '')).toEqual({
      'X-Trace': 'keep',
      '*': true,
    })
  })

  test('empty headers default off and removing the last gzip override clears the field', async () => {
    const user = userEvent.setup()
    const saved: ChannelFormValues[] = []
    render(<SettingsForm onSave={(value) => saved.push(value)} />)
    const toggle = screen.getByRole('switch', { name: label })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(saved[0].header_override).toBe('')
  })

  test('mixed-case gzip overrides load enabled, normalize on toggle and survive create/update/reload', async () => {
    const user = userEvent.setup()
    const saved: ChannelFormValues[] = []
    const view = render(
      <SettingsForm
        headers='{" content-ENCODING ":" GZip ","X-Trace":"keep"}'
        onSave={(value) => saved.push(value)}
      />
    )
    const toggle = screen.getByRole('switch', { name: label })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const channel = channelSchema.parse({
      id: 1,
      name: 'Test channel',
      key: '',
      type: 1,
      status: 1,
      created_time: 0,
      test_time: 0,
      response_time: 0,
      balance_updated_time: 0,
    })
    for (const payload of [
      transformFormDataToCreatePayload(saved[0]).channel,
      transformFormDataToUpdatePayload(saved[0], channel.id),
    ]) {
      expect(JSON.parse(payload.header_override ?? '')).toEqual({
        'X-Trace': 'keep',
        'Content-Encoding': 'gzip',
      })
      expect(
        transformChannelToFormDefaults({
          ...channel,
          header_override: payload.header_override,
        }).header_override
      ).toBe(payload.header_override)
    }
    const reloaded = transformChannelToFormDefaults({
      ...channel,
      header_override: saved[0].header_override,
    })
    view.unmount()
    render(
      <SettingsForm
        headers={reloaded.header_override}
        onSave={() => undefined}
      />
    )
    expect(screen.getByRole('switch', { name: label })).toBeChecked()
  })

  test('manual header-editor changes update the switch without saving', async () => {
    const user = userEvent.setup()
    render(<SettingsForm onSave={() => undefined} />)
    const editor = screen.getByRole('textbox', { name: 'Header overrides' })
    await user.click(editor)
    await user.paste('{"content-encoding":"gzip"}')
    expect(screen.getByRole('switch', { name: label })).toBeChecked()
    await user.clear(editor)
    expect(screen.getByRole('switch', { name: label })).not.toBeChecked()
  })

  test.each(['{"Content-Encoding":', '[]'])(
    'invalid header JSON %s disables toggling and preserves the editor text',
    async (headers) => {
      const user = userEvent.setup()
      render(<SettingsForm headers={headers} onSave={() => undefined} />)
      const toggle = screen.getByRole('switch', { name: label })
      expect(toggle).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText('Invalid JSON format')).toBeInTheDocument()
      await user.click(toggle)
      expect(
        screen.getByRole('textbox', { name: 'Header overrides' })
      ).toHaveValue(headers)
    }
  )

  test('an unsupported encoding disables the shortcut and preserves all overrides', async () => {
    const user = userEvent.setup()
    const saved: ChannelFormValues[] = []
    const headers = '{"Content-Encoding":"deflate","X-Trace":"keep"}'
    render(
      <SettingsForm headers={headers} onSave={(value) => saved.push(value)} />
    )
    const toggle = screen.getByRole('switch', { name: label })
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText(
        'Remove unsupported or conflicting Content-Encoding overrides before enabling compression.'
      )
    ).toBeInTheDocument()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(saved[0].header_override).toBe(headers)
  })

  test('locked settings keep configured gzip enabled after click and keyboard interaction', async () => {
    const user = userEvent.setup()
    render(
      <SettingsForm
        headers='{"Content-Encoding":"gzip"}'
        disabled
        onSave={() => undefined}
      />
    )
    const toggle = screen.getByRole('switch', { name: label })
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await user.click(toggle)
    toggle.focus()
    await user.keyboard(' ')
    expect(toggle).toBeChecked()
  })

  test.each([
    ['gzip', 'gzip'],
    ['zstd', 'zstd'],
    ['br', 'Brotli (br)'],
  ])(
    'selecting %s saves the algorithm and custom threshold without losing headers',
    async (encoding, option) => {
      const user = userEvent.setup()
      const saved: ChannelFormValues[] = []
      const view = render(
        <SettingsForm
          headers='{"X-Trace":"keep"}'
          onSave={(value) => saved.push(value)}
        />
      )
      await user.click(screen.getByRole('switch', { name: label }))
      const selector = screen.getByRole('combobox', {
        name: 'Request compression algorithm',
      })
      if (encoding !== 'gzip') {
        await user.click(selector)
        await user.click(screen.getByRole('option', { name: option }))
      }
      const minimum = screen.getByRole('spinbutton', {
        name: 'Minimum JSON size (KiB)',
      })
      expect(minimum).toHaveValue(64)
      await user.clear(minimum)
      await user.type(minimum, '32')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      const payload = transformFormDataToCreatePayload(saved[0]).channel
      expect(JSON.parse(payload.header_override ?? '')).toEqual({
        'X-Trace': 'keep',
        'Content-Encoding': encoding,
        'X-New-Api-Compression-Min-Bytes': '32768',
      })
      view.unmount()
      render(
        <SettingsForm
          headers={payload.header_override ?? ''}
          onSave={() => undefined}
        />
      )
      expect(screen.getByRole('switch', { name: label })).toBeChecked()
      expect(
        screen.getByRole('combobox', { name: 'Request compression algorithm' })
      ).toHaveTextContent(option)
      expect(
        screen.getByRole('spinbutton', { name: 'Minimum JSON size (KiB)' })
      ).toHaveValue(32)
    }
  )

  test('zero threshold persists and locked compression controls cannot be changed', async () => {
    const user = userEvent.setup()
    const saved: ChannelFormValues[] = []
    const view = render(
      <SettingsForm
        headers='{"Content-Encoding":"zstd"}'
        onSave={(value) => saved.push(value)}
      />
    )
    const minimum = screen.getByRole('spinbutton', {
      name: 'Minimum JSON size (KiB)',
    })
    await user.clear(minimum)
    await user.type(minimum, '0')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      JSON.parse(saved[0].header_override ?? '')[
        'X-New-Api-Compression-Min-Bytes'
      ]
    ).toBe('0')
    view.unmount()
    render(
      <SettingsForm
        headers={saved[0].header_override ?? ''}
        disabled
        onSave={() => undefined}
      />
    )
    expect(
      screen.getByRole('combobox', { name: 'Request compression algorithm' })
    ).toBeDisabled()
    expect(
      screen.getByRole('spinbutton', { name: 'Minimum JSON size (KiB)' })
    ).toBeDisabled()
  })
})

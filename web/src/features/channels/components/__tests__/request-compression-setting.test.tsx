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

const label = 'Compress upstream JSON requests (gzip)'

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

  test('an existing non-gzip encoding disables the shortcut and preserves all overrides', async () => {
    const user = userEvent.setup()
    const saved: ChannelFormValues[] = []
    const headers = '{"Content-Encoding":"zstd","X-Trace":"keep"}'
    render(
      <SettingsForm headers={headers} onSave={(value) => saved.push(value)} />
    )
    const toggle = screen.getByRole('switch', { name: label })
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText(
        'Remove the existing Content-Encoding override before enabling gzip.'
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
})

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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CCSwitchDialog } from '../cc-switch-dialog'

let queryClient: QueryClient

beforeEach(() => {
  localStorage.clear()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
})

afterEach(() => {
  queryClient.clear()
})

function renderDialog(
  models = ['gpt-5.4', 'claude-sonnet-4-6'],
  tokenKey = 'test-only'
) {
  queryClient.setQueryData(['user-models-ccswitch'], {
    success: true,
    data: models,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <CCSwitchDialog open onOpenChange={vi.fn()} tokenKey={tokenKey} />
    </QueryClientProvider>
  )
}

describe('CC Switch model selection', () => {
  it.each(['Claude Code', 'Codex', 'Gemini CLI'])(
    'opens %s models outside the clipping dialog and keeps the dialog open after selection',
    async (app) => {
      renderDialog()
      const user = userEvent.setup()
      await user.click(screen.getByRole('combobox', { name: 'Application' }))
      await user.click(await screen.findByRole('option', { name: app }))
      const input = screen.getByRole('combobox', { name: 'Primary Model' })

      await user.click(input)

      expect(input).toHaveAttribute('aria-expanded', 'true')
      const list = await screen.findByRole('listbox')
      const dialog = screen.getByRole('dialog', { name: 'Import to CC Switch' })
      // The dialog is translated and clips overflow. Its popup must escape
      // that containing block to remain aligned and fully visible.
      expect(dialog).not.toContainElement(list)
      await user.click(screen.getByRole('option', { name: 'gpt-5.4' }))
      await waitFor(() => expect(input).toHaveValue('gpt-5.4'))
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(dialog).toBeVisible()
    }
  )

  it('filters model names and supports keyboard selection and Escape without closing the dialog', async () => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Application' }))
    await user.click(await screen.findByRole('option', { name: 'Codex' }))
    const input = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(input)
    await user.type(input, 'sonnet')

    expect(
      screen.queryByRole('option', { name: 'gpt-5.4' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'claude-sonnet-4-6' })
    ).toBeVisible()
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(input).toHaveValue('claude-sonnet-4-6'))
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('claude-sonnet-4-6')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('shows an empty result when no models are available and updates an open dropdown when models arrive', async () => {
    renderDialog([])
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Application' }))
    await user.click(await screen.findByRole('option', { name: 'Codex' }))
    const input = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(screen.getByRole('button', { name: 'Primary Model' }))

    expect(await screen.findByText('No models found')).toBeVisible()
    await act(async () => {
      queryClient.setQueryData(['user-models-ccswitch'], {
        success: true,
        data: ['gpt-5.4'],
      })
    })
    await user.click(await screen.findByRole('option', { name: 'gpt-5.4' }))
    await waitFor(() => expect(input).toHaveValue('gpt-5.4'))
  })

  it('lets users edit the provider name without opening a model dropdown', async () => {
    renderDialog()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'Name' })

    await user.clear(input)
    await user.type(input, 'Development')

    expect(input).toHaveValue('Development')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('CC Switch provider compatibility', () => {
  it('selects the final supported app by keyboard and closes its popup without closing the dialog', async () => {
    renderDialog()
    const user = userEvent.setup()
    const application = screen.getByRole('combobox', { name: 'Application' })
    application.focus()

    await user.keyboard('{ArrowDown}{End}{Enter}')

    await waitFor(() => expect(application).toHaveTextContent('Pi'))
    expect(application).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('combobox', { name: 'Haiku Model' })).toBeNull()
    await user.click(application)
    await user.keyboard('{Escape}')
    expect(application).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it.each([
    {
      app: 'claude',
      label: 'Claude Code',
      format: 'anthropic',
      endpoint: 'https://gateway.example.test',
    },
    {
      app: 'codex',
      label: 'Codex',
      format: 'openai_responses',
      endpoint: 'https://gateway.example.test/v1',
    },
    {
      app: 'gemini',
      label: 'Gemini CLI',
      format: 'gemini_native',
      endpoint: 'https://gateway.example.test',
    },
    {
      app: 'agy',
      label: 'Antigravity CLI',
      format: 'gemini_native',
      endpoint: 'https://gateway.example.test',
    },
    {
      app: 'grokbuild',
      label: 'Grok Build',
      format: 'openai_responses',
      endpoint: 'https://gateway.example.test/v1',
    },
    {
      app: 'opencode',
      label: 'OpenCode',
      format: 'openai_chat',
      endpoint: 'https://gateway.example.test/v1',
    },
    {
      app: 'openclaw',
      label: 'OpenClaw',
      format: 'openai_chat',
      endpoint: 'https://gateway.example.test/v1',
    },
    {
      app: 'hermes',
      label: 'Hermes',
      format: 'openai_chat',
      endpoint: 'https://gateway.example.test/v1',
    },
    {
      app: 'pi',
      label: 'Pi',
      format: 'openai_chat',
      endpoint: 'https://gateway.example.test/v1',
    },
  ])(
    'imports $label with its official provider protocol and a literal encoded key',
    async ({ app, label, format, endpoint }) => {
      localStorage.setItem(
        'status',
        JSON.stringify({ server_address: 'https://gateway.example.test/' })
      )
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      const key = 'sk-test+/%?& 中文'
      renderDialog(['my-model+中文'], key)
      const user = userEvent.setup()
      await user.click(screen.getByRole('combobox', { name: 'Application' }))
      const options = await screen.findAllByRole('option')
      expect(options).toHaveLength(9)
      await user.click(screen.getByRole('option', { name: label }))
      await user.click(screen.getByRole('combobox', { name: 'Primary Model' }))
      await user.click(
        await screen.findByRole('option', { name: 'my-model+中文' })
      )
      const name = screen.getByRole('textbox', { name: 'Name' })
      await user.clear(name)
      await user.type(name, '提供商 + A&B')

      expect(document.body.innerHTML).not.toContain(key)
      expect(document.querySelector('a[href^="ccswitch:"]')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))

      expect(open).toHaveBeenCalledOnce()
      const [raw, target, features] = open.mock.calls[0]
      const url = new URL(String(raw))
      expect(url.protocol).toBe('ccswitch:')
      expect(url.host).toBe('v1')
      expect(url.pathname).toBe('/import')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        resource: 'provider',
        app,
        apiFormat: format,
        name: '提供商 + A&B',
        endpoint,
        apiKey: key,
        model: 'my-model+中文',
        homepage: 'https://gateway.example.test',
        enabled: 'false',
      })
      expect(target).toBe('_blank')
      expect(features).toBe('noopener,noreferrer')
    }
  )

  it.each([
    {
      label: 'Claude Code',
      suffix: '/v1/',
      endpoint: 'https://gateway.example.test/proxy',
    },
    {
      label: 'Codex',
      suffix: '/v1/',
      endpoint: 'https://gateway.example.test/proxy/v1',
    },
    {
      label: 'OpenCode',
      suffix: '/v1/',
      endpoint: 'https://gateway.example.test/proxy/v1',
    },
    {
      label: 'Claude Code',
      suffix: '/v1beta/',
      endpoint: 'https://gateway.example.test/proxy',
    },
    {
      label: 'Codex',
      suffix: '/v1beta/',
      endpoint: 'https://gateway.example.test/proxy/v1',
    },
    {
      label: 'Claude Code',
      suffix: '/V1',
      endpoint: 'https://gateway.example.test/proxy',
    },
    {
      label: 'Codex',
      suffix: '/V1',
      endpoint: 'https://gateway.example.test/proxy/v1',
    },
  ])(
    'preserves a reverse-proxy prefix and normalizes $suffix for $label',
    async ({ label, suffix, endpoint }) => {
      localStorage.setItem(
        'status',
        JSON.stringify({
          server_address: `https://gateway.example.test/proxy${suffix}`,
        })
      )
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      renderDialog()
      const user = userEvent.setup()
      await user.click(screen.getByRole('combobox', { name: 'Application' }))
      await user.click(await screen.findByRole('option', { name: label }))
      await user.click(screen.getByRole('combobox', { name: 'Primary Model' }))
      await user.click(await screen.findByRole('option', { name: 'gpt-5.4' }))
      await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))

      const url = new URL(String(open.mock.calls[0][0]))
      expect(url.searchParams.get('endpoint')).toBe(endpoint)
      expect(url.searchParams.get('apiKey')).toBe('sk-test-only')
    }
  )

  it('keeps Claude aliases and uses a newly selected primary model on import', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Haiku Model' }))
    await user.click(
      await screen.findByRole('option', { name: 'claude-sonnet-4-6' })
    )
    const primary = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(primary)
    await user.click(await screen.findByRole('option', { name: 'gpt-5.4' }))
    await user.click(primary)
    await user.click(
      await screen.findByRole('option', { name: 'claude-sonnet-4-6' })
    )
    await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))

    const url = new URL(String(open.mock.calls[0][0]))
    expect(url.searchParams.get('model')).toBe('claude-sonnet-4-6')
    expect(url.searchParams.get('haikuModel')).toBe('claude-sonnet-4-6')
  })
})

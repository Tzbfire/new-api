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
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { requestImageArchiveDownload } from '../api'

const originalAdapter = api.defaults.adapter

beforeEach(() => {
  useAuthStore.getState().auth.setBundle({
    access_token: 'test-dashboard-token',
    token_type: 'Bearer',
    access_expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 42, username: 'studio-user', role: 1 },
    session: {
      sid: 'studio-session',
      current: true,
      login_method: 'password',
      ip: '127.0.0.1',
      user_agent: 'test',
      created_at: 1,
      last_active_at: 1,
      expires_at: 2_000_000_000,
    },
  })
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  useAuthStore.getState().auth.reset('idle')
})

test.each([
  { scope: 'tasks' as const, task_ids: ['task-one', 'task-two'] },
  { scope: 'batch' as const, batch_id: 'batch-one' },
  { scope: 'library' as const },
])(
  'requests a scoped download ticket with dashboard authentication: $scope',
  async (payload) => {
    let request: InternalAxiosRequestConfig | undefined
    api.defaults.adapter = async (config) => {
      request = config
      return {
        data: {
          success: true,
          data: {
            url: '/api/image-studio/download?ticket=test-ticket',
            expires_at: 2_000_000_000,
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const url = await requestImageArchiveDownload(payload)
    expect(request?.method).toBe('post')
    expect(request?.url).toBe('/api/image-studio/download-ticket')
    expect(request?.headers.get('Authorization')).toBe(
      'Bearer test-dashboard-token'
    )
    expect(JSON.parse(request?.data as string)).toEqual(payload)
    expect(url).toBe('/api/image-studio/download?ticket=test-ticket')
    expect(url).not.toContain('test-dashboard-token')
  }
)

test('rejects a denied archive request instead of navigating to a download', async () => {
  api.defaults.adapter = async (config) => ({
    data: { success: false, message: 'Bulk downloads are disabled' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
  await expect(
    requestImageArchiveDownload({ scope: 'library' })
  ).rejects.toThrow('Bulk downloads are disabled')
})

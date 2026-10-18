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
import { afterEach, expect, test } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { wechatLoginByCode } from '../api'
import { saveAffiliateCode } from '../lib/storage'

const originalAdapter = api.defaults.adapter

afterEach(() => {
  api.defaults.adapter = originalAdapter
  window.localStorage.removeItem('aff')
  useAuthStore.getState().auth.reset('idle')
})

test('forwards the saved affiliate code alongside the WeChat authorization code', async () => {
  useAuthStore.getState().auth.reset('complete')
  saveAffiliateCode('referral-code')
  api.defaults.adapter = async (config) => {
    expect(config.url).toBe('/api/oauth/wechat')
    expect(config.params).toEqual({ code: 'wechat-code', aff: 'referral-code' })
    return {
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  expect(await wechatLoginByCode('wechat-code')).toEqual({ success: true })
})

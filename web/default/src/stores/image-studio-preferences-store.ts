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
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ImageStudioPreference = {
  group: string
  model: string
}

type ImageStudioPreferencesState = {
  hasHydrated: boolean
  preferencesByUser: Record<string, ImageStudioPreference>
  setHasHydrated: (hasHydrated: boolean) => void
  setPreference: (userId: number, preference: ImageStudioPreference) => void
  migrateLegacyPreference: (userId: number) => ImageStudioPreference | undefined
}

const LEGACY_GROUP_KEY = 'image_studio.last_group'
const LEGACY_MODEL_KEY = 'image_studio.last_model'

function removeLegacyPreference() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LEGACY_GROUP_KEY)
    window.localStorage.removeItem(LEGACY_MODEL_KEY)
  } catch {}
}

export const useImageStudioPreferencesStore =
  create<ImageStudioPreferencesState>()(
    persist(
      (set, get) => ({
        hasHydrated: false,
        preferencesByUser: {},
        setHasHydrated: (hasHydrated) => set({ hasHydrated }),
        setPreference: (userId, preference) =>
          set((state) => ({
            preferencesByUser: {
              ...state.preferencesByUser,
              [String(userId)]: preference,
            },
          })),
        migrateLegacyPreference: (userId) => {
          const existing = get().preferencesByUser[String(userId)]
          if (existing) {
            removeLegacyPreference()
            return existing
          }
          if (typeof window === 'undefined') return undefined
          try {
            const group = window.localStorage.getItem(LEGACY_GROUP_KEY)?.trim()
            if (!group) return undefined
            const preference = {
              group,
              model:
                window.localStorage.getItem(LEGACY_MODEL_KEY)?.trim() ?? '',
            }
            set((state) => ({
              preferencesByUser: {
                ...state.preferencesByUser,
                [String(userId)]: preference,
              },
            }))
            removeLegacyPreference()
            return preference
          } catch {
            return undefined
          }
        },
      }),
      {
        name: 'image-studio-preferences-v1',
        version: 1,
        partialize: (state) => ({
          preferencesByUser: state.preferencesByUser,
        }),
        onRehydrateStorage: () => (state) => {
          state?.setHasHydrated(true)
        },
      }
    )
  )

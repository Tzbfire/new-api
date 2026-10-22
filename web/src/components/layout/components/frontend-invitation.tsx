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
import { useRouterState } from '@tanstack/react-router'
import { Image, KeyRound, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'

const invitationStorageKey = 'factory:choice:frontend-invitation:v1'

export function FrontendInvitation() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [eligible, setEligible] = useState(() => {
    try {
      const preference = localStorage.getItem('factory:frontend')
      const hasCookie =
        /(?:^|;\s*)factory_frontend=(consumer|legacy)(?:;|$)/.test(
          document.cookie
        )
      return (
        !hasCookie &&
        preference !== 'consumer' &&
        preference !== 'legacy' &&
        !localStorage.getItem(invitationStorageKey)
      )
    } catch {
      // If the browser cannot remember dismissal, keep browsing uninterrupted.
      return false
    }
  })

  function dismiss() {
    setEligible(false)
    try {
      localStorage.setItem(invitationStorageKey, 'dismissed')
    } catch {
      // The current page still remembers the decision when storage is blocked.
    }
  }

  if (
    !eligible ||
    pathname !== '/' ||
    !status?.frontend_enabled ||
    !status.frontend_available
  ) {
    return null
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
      contentClassName='sm:max-w-lg'
      title={
        <>
          <Badge variant='secondary' className='mb-3'>
            {t('New release')}
          </Badge>
          <span className='block text-xl leading-snug'>
            {t('A new interface to explore')}
          </span>
        </>
      }
      description={t(
        'Chat, create images, and manage API keys in a simpler workspace. Your account and balance stay the same, and you can switch back anytime.'
      )}
      descriptionClassName='leading-relaxed'
      footer={
        <>
          <Button variant='outline' onClick={dismiss}>
            {t('Keep using the current interface')}
          </Button>
          <Button
            nativeButton={false}
            role='link'
            onClick={dismiss}
            render={<a href='/frontend/switch?version=consumer&return_to=/' />}
          >
            {t('Try the new interface')}
          </Button>
        </>
      }
    >
      <div className='grid grid-cols-3 gap-2 text-center text-xs sm:text-sm'>
        <div className='bg-muted/50 flex min-w-0 flex-col items-center gap-2 rounded-xl px-2 py-4'>
          <MessageCircle aria-hidden className='text-primary size-5' />
          <span className='break-words'>{t('Chat')}</span>
        </div>
        <div className='bg-muted/50 flex min-w-0 flex-col items-center gap-2 rounded-xl px-2 py-4'>
          <Image aria-hidden className='text-primary size-5' />
          <span className='break-words'>{t('AI Studio')}</span>
        </div>
        <div className='bg-muted/50 flex min-w-0 flex-col items-center gap-2 rounded-xl px-2 py-4'>
          <KeyRound aria-hidden className='text-primary size-5' />
          <span className='break-words'>{t('API keys')}</span>
        </div>
      </div>
    </Dialog>
  )
}

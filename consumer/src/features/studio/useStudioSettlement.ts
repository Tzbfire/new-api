import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/lib/session'

/** Reconcile read-only account and activity views when asynchronous image work settles. */
export function useStudioSettlement(settledKey: string) {
  const client = useQueryClient()
  const { refreshUser } = useSession()
  const previous = useRef('')
  useEffect(() => {
    if (!settledKey || settledKey === previous.current) return
    previous.current = settledKey
    void client.invalidateQueries({ queryKey: ['studio', 'batches'] })
    void client.invalidateQueries({ queryKey: ['usage-logs'] })
    void client.invalidateQueries({ queryKey: ['usage-stats'] })
    void client.invalidateQueries({ queryKey: ['usage-history'] })
    void refreshUser().catch(() => undefined)
  }, [settledKey, client, refreshUser])
}

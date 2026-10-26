import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Gift, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { formatQuota } from '@/lib/format'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { claimCheckin, getCheckinStatus, type CheckinReward } from './api'
import './checkin.css'

const CheckinDialog = lazy(() => import('./CheckinDialog'))
const CheckinContext = createContext<{
  checked: boolean
  busy: boolean
  needsConfirmation: boolean
  reward: string | null
  activate: () => void
} | null>(null)

/** One controller serves every entrance; account changes discard pending UI and cached identities. */
export function CheckinProvider(props: { children: ReactNode }) {
  const session = useSession()
  return (
    <CheckinSession key={`${session.user?.id}:${session.sessionId}`}>
      {props.children}
    </CheckinSession>
  )
}

function CheckinSession(props: { children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const session = useSession()
  const site = useStatus()
  const cache = useQueryClient()
  const enabled = !!session.user && site.data?.checkin_enabled === true
  const queryKey = ['checkin', session.user?.id, session.sessionId, 'current']
  const current = useQuery({
    queryKey,
    queryFn: ({ signal }) => getCheckinStatus(signal),
    enabled,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  })
  const claim = useMutation({
    mutationFn: async (token: string) => {
      await cache.cancelQueries({ queryKey })
      return claimCheckin(token, { userID: session.user?.id, sessionID: session.sessionId })
    },
    retry: false,
  })
  const [open, setOpen] = useState(false)
  const [reward, setReward] = useState<CheckinReward | null>(null)
  const [noticeQuota, setNoticeQuota] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [balancePending, setBalancePending] = useState(false)
  const [refreshingBalance, setRefreshingBalance] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (noticeQuota === null) return
    const timer = window.setTimeout(() => setNoticeQuota(null), 8000)
    return () => window.clearTimeout(timer)
  }, [noticeQuota])

  const checked =
    current.data?.stats.checked_in_today === true ||
    (!!reward && reward.checkin_date === current.data?.today)
  const rewardText =
    reward && reward.checkin_date === current.data?.today
      ? formatQuota(reward.quota_awarded, site.data, i18n.language, { maximumFractionDigits: 8 })
      : null

  useEffect(() => {
    const clock = current.data
    if (!enabled || !clock?.next_reset_at || !clock.server_time) return
    const timer = window.setTimeout(
      () => {
        setReward(null)
        void cache.invalidateQueries({ queryKey: ['checkin'] })
      },
      Math.max(
        1000,
        (clock.next_reset_at - clock.server_time) * 1000 + current.dataUpdatedAt - Date.now() + 100,
      ),
    )
    return () => window.clearTimeout(timer)
  }, [cache, enabled, current.data, current.dataUpdatedAt])

  async function refreshBalance() {
    setRefreshingBalance(true)
    try {
      await session.refreshUser()
      if (mounted.current) setBalancePending(false)
    } catch {
      if (mounted.current) {
        setBalancePending(true)
        setOpen(true)
      }
    } finally {
      if (mounted.current) setRefreshingBalance(false)
    }
  }

  async function refreshStatus() {
    const status = await current.refetch()
    if (!mounted.current || status.isError || !status.data) return
    setNeedsConfirmation(false)
    setError(null)
    if (status.data.stats.checked_in_today) void refreshBalance()
  }

  async function submit(token = '') {
    if (locked.current || checked || needsConfirmation || !enabled) return
    locked.current = true
    setError(null)
    try {
      const result = await claim.mutateAsync(token)
      if (!mounted.current) return
      setReward(result)
      setNoticeQuota(result.quota_awarded)
      cache.setQueryData(queryKey, (previous: typeof current.data) =>
        previous
          ? {
              ...previous,
              ...result,
              stats: { ...previous.stats, checked_in_today: true },
            }
          : previous,
      )
      setOpen(false)
      void current.refetch()
      void refreshBalance()
    } catch (failure) {
      if (!mounted.current) return
      // A lost response may already have credited the wallet. Never replay the POST automatically.
      setNeedsConfirmation(true)
      setOpen(true)
      const confirmed = await current.refetch()
      if (!mounted.current) return
      if (!confirmed.isError && confirmed.data) {
        setNeedsConfirmation(false)
        if (confirmed.data.stats.checked_in_today) {
          setError(null)
          const record = confirmed.data.stats.records.find(
            (record) => record.checkin_date === confirmed.data.today,
          )
          if (record) setNoticeQuota(record.quota_awarded)
          void refreshBalance()
        } else setError(failure)
      }
    } finally {
      if (mounted.current) locked.current = false
    }
  }

  function activate() {
    if (
      checked ||
      needsConfirmation ||
      current.isError ||
      !current.data ||
      site.data?.turnstile_check
    ) {
      setOpen(true)
      return
    }
    void submit()
  }

  return (
    <CheckinContext.Provider
      value={
        enabled
          ? {
              checked,
              busy: claim.isPending || (current.isPending && current.isFetching),
              needsConfirmation,
              reward: rewardText,
              activate,
            }
          : null
      }
    >
      {props.children}
      {noticeQuota !== null && (
        <div className="checkin-toast" role="status">
          <Check size={18} aria-hidden />
          <span>
            {t('Check-in successful. {{amount}} added to your balance.', {
              amount: formatQuota(noticeQuota, site.data, i18n.language, {
                maximumFractionDigits: 8,
              }),
            })}
          </span>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label={t('Close')}
            onClick={() => setNoticeQuota(null)}
          >
            <X size={16} aria-hidden />
          </Button>
        </div>
      )}
      {enabled && open && (
        <Suspense fallback={null}>
          <CheckinDialog
            status={current.data}
            statusError={current.error}
            error={error}
            checked={checked}
            busy={claim.isPending || current.isFetching}
            needsConfirmation={needsConfirmation}
            balancePending={balancePending}
            refreshingBalance={refreshingBalance}
            onClose={() => setOpen(false)}
            onRefreshStatus={() => void refreshStatus()}
            onRefreshBalance={() => void refreshBalance()}
            onSubmit={(token) => void submit(token)}
          />
        </Suspense>
      )}
    </CheckinContext.Provider>
  )
}

export function CheckinButton(props: {
  className?: string
  iconOnly?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const checkin = useContext(CheckinContext)
  if (!checkin) return null
  let label = t('Check in for credit')
  if (checkin.needsConfirmation) label = t('Refresh check-in status')
  if (checkin.checked)
    label = checkin.reward
      ? t('Claimed {{amount}}', { amount: checkin.reward })
      : t('Checked in today')
  return (
    <Button
      variant="ghost"
      className={`checkin-button ${props.className || ''}`}
      aria-label={label}
      title={label}
      busy={checkin.busy}
      onClick={checkin.activate}
    >
      {checkin.checked ? <Check size={15} aria-hidden /> : <Gift size={15} aria-hidden />}
      {!props.iconOnly && (
        <span>{props.compact ? t(checkin.checked ? 'Checked in' : 'Check in') : label}</span>
      )}
    </Button>
  )
}

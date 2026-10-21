import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { Bell, Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, ErrorState, LoadingState, Modal } from '@/components/ui'
import { request } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import { useStatus } from '@/lib/status'

const AnnouncementContent = lazy(() => import('./content'))
const preferenceKey = 'factory:choice:announcements:v1'
const sessionKey = 'factory:notice:session:v1'
type Panel = 'notice' | 'updates'
type ReadState = { notice: string; items: string[]; snoozedNotice: string; snoozedUntil: number }
const AnnouncementsContext = createContext<{ unread: number; open: () => void } | null>(null)

function readNoticeState(): ReadState {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}')
    return {
      notice: typeof value.notice === 'string' ? value.notice : '',
      items: Array.isArray(value.items)
        ? value.items.filter((key: unknown) => typeof key === 'string').slice(-100)
        : [],
      snoozedNotice: typeof value.snoozedNotice === 'string' ? value.snoozedNotice : '',
      snoozedUntil: Number.isFinite(value.snoozedUntil) ? value.snoozedUntil : 0,
    }
  } catch {
    return { notice: '', items: [], snoozedNotice: '', snoozedUntil: 0 }
  }
}

export function AnnouncementButton() {
  const announcements = useContext(AnnouncementsContext)
  const { t, i18n } = useTranslation()
  if (!announcements) return null
  return (
    <Button
      variant="ghost"
      className="icon-button announcement-trigger"
      aria-label={
        announcements.unread
          ? t('Announcements, {{count}} unread', { count: announcements.unread })
          : t('Announcements')
      }
      title={t('Announcements')}
      onClick={announcements.open}
    >
      <Bell size={19} aria-hidden />
      {announcements.unread > 0 && (
        <span className="announcement-count" aria-hidden>
          {formatNumber(announcements.unread, i18n.language)}
        </span>
      )}
    </Button>
  )
}

export function AnnouncementsProvider(props: { children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const id = useId()
  const status = useStatus({ refetchOnWindowFocus: true })
  const noticeQuery = useQuery({
    queryKey: ['site-notice'],
    queryFn: ({ signal }) => request<unknown>('/api/notice', { signal }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
  const notice = typeof noticeQuery.data === 'string' ? noticeQuery.data.trim() : ''
  const items = useMemo(() => {
    if (!status.data?.announcements_enabled || !Array.isArray(status.data.announcements)) return []
    const result = status.data.announcements.flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      if (typeof item.content !== 'string' || !item.content.trim()) return []
      const content = item.content.trim()
      const extra = typeof item.extra === 'string' ? item.extra.trim() : ''
      const date = typeof item.publishDate === 'string' ? Date.parse(item.publishDate) : NaN
      const type = ['default', 'ongoing', 'success', 'warning', 'error'].includes(String(item.type))
        ? String(item.type)
        : 'default'
      // Content is part of the identity: edits to an existing id are unread again.
      const key = JSON.stringify([item.id, content, extra, item.publishDate, type])
      return [{ content, extra, date, type, key }]
    })
    return [...new Map(result.map((item) => [item.key, item])).values()]
      .sort(
        (a, b) => (Number.isFinite(b.date) ? b.date : 0) - (Number.isFinite(a.date) ? a.date : 0),
      )
      .slice(0, 20)
  }, [status.data])
  const [read, setRead] = useState(readNoticeState)
  const [closedNotice, setClosedNotice] = useState(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(sessionKey) || '{}')
      if (typeof value.content === 'string' && Number.isFinite(value.until))
        return { content: value.content, until: value.until }
    } catch {
      /* Restricted or invalid storage is optional. */
    }
    return { content: '', until: 0 }
  })
  const [panel, setPanel] = useState<Panel | null>(null)
  const [lastPanel, setLastPanel] = useState<Panel>('notice')
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) setRead(readNoticeState())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const noticeUnread = Boolean(notice && notice !== read.notice)
  const unreadItems = items.filter((item) => !read.items.includes(item.key)).length
  const automaticNotice =
    notice &&
    (closedNotice.content !== notice || closedNotice.until <= Date.now()) &&
    !(read.snoozedNotice === notice && read.snoozedUntil > Date.now()) &&
    !/^\/(?:login|register|reset|oauth|app\/(?:reset|oauth))(?:\/|$)/.test(location.pathname)
  const activePanel = panel ?? (automaticNotice ? 'notice' : null)
  const visiblePanel = activePanel || lastPanel

  function saveRead(next: ReadState) {
    setRead(next)
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next))
    } catch {
      /* Browsing still works without storage. */
    }
  }
  function dismissNotice() {
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    const next = { content: notice, until: midnight.getTime() }
    setClosedNotice(next)
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify(next))
    } catch {
      /* Keep the in-memory dismissal. */
    }
  }
  function selectPanel(next: Panel) {
    dismissNotice()
    saveRead({
      ...read,
      notice: next === 'notice' || activePanel === 'notice' ? notice : read.notice,
      items:
        next === 'updates'
          ? [...new Set([...read.items, ...items.map((item) => item.key)])].slice(-100)
          : read.items,
    })
    setLastPanel(next)
    setPanel(next)
  }
  function closePanel(today = false) {
    if (activePanel) setLastPanel(activePanel)
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    saveRead({
      ...read,
      notice: activePanel === 'notice' && !noticeQuery.isError ? notice : read.notice,
      items:
        activePanel === 'updates' && !status.isError
          ? [...new Set([...read.items, ...items.map((item) => item.key)])].slice(-100)
          : read.items,
      ...(today ? { snoozedNotice: notice, snoozedUntil: midnight.getTime() } : {}),
    })
    dismissNotice()
    setPanel(null)
  }
  function openPanel() {
    selectPanel(noticeUnread || !unreadItems ? 'notice' : 'updates')
    void noticeQuery.refetch()
    void status.refetch()
  }

  let content: ReactNode
  if (visiblePanel === 'notice') {
    if (noticeQuery.isError)
      content = <ErrorState error={noticeQuery.error} retry={() => void noticeQuery.refetch()} />
    else if (noticeQuery.isPending) content = <LoadingState />
    else if (notice) content = <AnnouncementContent content={notice} />
    else
      content = (
        <EmptyState
          title={t('No system notice right now')}
          description={t('New notices will appear here.')}
        />
      )
  } else if (status.isError) {
    content = <ErrorState error={status.error} retry={() => void status.refetch()} />
  } else if (status.isPending) {
    content = <LoadingState />
  } else if (items.length) {
    content = (
      <div className="announcement-timeline">
        {items.map((item) => (
          <article key={item.key} className={`announcement-item announcement-item-${item.type}`}>
            {Number.isFinite(item.date) && (
              <time dateTime={new Date(item.date).toISOString()}>
                {formatDate(item.date / 1000, i18n.language)}
              </time>
            )}
            <AnnouncementContent content={item.content} />
            {item.extra && (
              <div className="muted announcement-extra">
                <AnnouncementContent content={item.extra} />
              </div>
            )}
          </article>
        ))}
      </div>
    )
  } else {
    content = (
      <EmptyState
        title={t('No platform updates yet')}
        description={t('New notices will appear here.')}
      />
    )
  }

  return (
    <AnnouncementsContext.Provider
      value={{ unread: Number(noticeUnread) + unreadItems, open: openPanel }}
    >
      {props.children}
      <Modal
        open={activePanel !== null}
        onClose={() => closePanel()}
        title={t('Announcements')}
        className="announcements-modal"
      >
        <div className="announcement-tabs" role="tablist" aria-label={t('Announcements')}>
          {(['notice', 'updates'] as const).map((tab) => (
            <Button
              key={tab}
              id={`${id}-${tab}`}
              role="tab"
              aria-selected={visiblePanel === tab}
              aria-controls={`${id}-panel`}
              tabIndex={visiblePanel === tab ? 0 : -1}
              variant={visiblePanel === tab ? 'secondary' : 'ghost'}
              onClick={() => selectPanel(tab)}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault()
                  let next: Panel = tab === 'notice' ? 'updates' : 'notice'
                  if (event.key === 'Home') next = 'notice'
                  if (event.key === 'End') next = 'updates'
                  selectPanel(next)
                  document.getElementById(`${id}-${next}`)?.focus()
                }
              }}
            >
              {tab === 'notice' ? (
                <Bell size={16} aria-hidden />
              ) : (
                <Megaphone size={16} aria-hidden />
              )}
              {tab === 'notice' ? t('System notice') : t('Platform updates')}
            </Button>
          ))}
        </div>
        <div
          className="announcement-body"
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${visiblePanel}`}
          tabIndex={0}
        >
          <Suspense fallback={<LoadingState />}>{content}</Suspense>
        </div>
        <div className="dialog-actions announcement-actions">
          {visiblePanel === 'notice' && notice && (
            <Button variant="ghost" onClick={() => closePanel(true)}>
              {t('Do not remind me today')}
            </Button>
          )}
          <Button onClick={() => closePanel()}>{t('Got it')}</Button>
        </div>
      </Modal>
    </AnnouncementsContext.Provider>
  )
}

import { Suspense, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from '@tanstack/react-router'
import {
  Boxes,
  ChevronRight,
  CircleHelp,
  CreditCard,
  ImagePlus,
  KeyRound,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  MessageCircle,
  Plus,
  ReceiptText,
  Settings2,
  Sparkles,
  Wallet,
  X,
  ChartNoAxesCombined,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { formatBalance } from '@/lib/format'
import { readPreference, savePreference } from '@/lib/preferences'
import { Button, LoadingState, Modal } from './ui'
import { Preferences } from './preferences'
import { FrontendEntry } from './frontend-entry'
import { AnnouncementButton } from '@/features/announcements'
import { Brand } from './brand'
import { CheckinButton, CheckinProvider } from '@/features/checkin'
const creativeNav = [
  { to: '/model-pricing', label: 'Models and pricing', icon: Boxes },
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/studio', label: 'Image studio', icon: ImagePlus },
] as const
const accountNav = [
  { to: '/keys', label: 'API keys', icon: KeyRound },
  { to: '/usage', label: 'Usage', icon: ChartNoAxesCombined },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/plans', label: 'Plans', icon: CreditCard },
  { to: '/orders', label: 'Orders', icon: ReceiptText },
] as const
export function AppShell() {
  const { t, i18n } = useTranslation()
  const { user } = useSession()
  const status = useStatus()
  const location = useLocation()
  const isChat = /\/chat\/?$/.test(location.pathname)
  const isStudio = /\/(?:studio|image-studio)\/?$/.test(location.pathname)
  const [navCollapsed, setNavCollapsed] = useState(
    () => readPreference('navigation:collapsed') === 'true',
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])
  const nav = (
    <>
      <div className="sidebar-heading">
        <Brand />
        <Button
          variant="ghost"
          className="icon-button mobile-only"
          aria-label={t('Close navigation')}
          onClick={() => setMobileOpen(false)}
        >
          <X size={18} />
        </Button>
      </div>
      <Button
        variant="ghost"
        className="sidebar-toggle"
        aria-label={t(navCollapsed ? 'Expand navigation' : 'Collapse navigation')}
        title={t(navCollapsed ? 'Expand navigation' : 'Collapse navigation')}
        aria-expanded={!navCollapsed}
        onClick={() => {
          setNavCollapsed((value) => {
            savePreference('navigation:collapsed', String(!value))
            return !value
          })
        }}
      >
        {navCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        <span>{t('Collapse navigation')}</span>
      </Button>
      <Link to="/chat" className="button new-chat-button">
        <Plus size={18} />
        {t('Ask your first question')}
      </Link>
      <nav aria-label={t('Main navigation')}>
        <span className="nav-section-label">{t('AI SERVICES')}</span>
        {creativeNav.map((item) => (
          <Link
            to={item.to}
            key={item.to}
            aria-label={t(item.label)}
            title={t(item.label)}
            activeProps={{ className: 'nav-link active' }}
            inactiveProps={{ className: 'nav-link' }}
          >
            <item.icon size={19} />
            <span>{t(item.label)}</span>
            {item.to === '/studio' && <span className="nav-dot" />}
          </Link>
        ))}
        <span className="nav-section-label account-nav-label">{t('ACCESS AND BILLING')}</span>
        {accountNav.map((item) => (
          <Link
            to={item.to}
            key={item.to}
            aria-label={t(item.label)}
            title={t(item.label)}
            activeProps={{ className: 'nav-link active' }}
            inactiveProps={{ className: 'nav-link' }}
          >
            <item.icon size={19} />
            <span>{t(item.label)}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {user && (
          <div className="balance-mini">
            <Link to="/wallet">
              <span className="row">
                <Sparkles size={16} />
                {t('Available balance')}
              </span>
              <strong>{formatBalance(user.quota, status.data, i18n.language)}</strong>
            </Link>
            <div className="balance-action">
              <Link to="/wallet">
                {t('Add balance')}
                <ChevronRight size={15} />
              </Link>
              <CheckinButton compact />
            </div>
          </div>
        )}
        <CheckinButton className="sidebar-checkin-shortcut" iconOnly />
        <div className="sidebar-tools">
          <Button
            variant="ghost"
            aria-label={t('Quick guide')}
            title={t('Quick guide')}
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={17} />
            <span>{t('Quick guide')}</span>
          </Button>
          <Preferences />
        </div>
        <Link
          to={user ? '/account' : '/login'}
          className="profile-link"
          aria-label={user ? t('Profile and security') : t('Sign in to your space')}
          title={user ? t('Profile and security') : t('Sign in to your space')}
        >
          <span className="avatar">
            {(user?.display_name || user?.username || 'F').slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{user?.display_name || user?.username || t('Welcome, curious mind')}</strong>
            <small>{user ? t('Profile and security') : t('Sign in to your space')}</small>
          </span>
          <Settings2 size={17} />
        </Link>
        <span className="sidebar-attribution">New API · QuantumNous</span>
      </div>
    </>
  )
  return (
    <CheckinProvider>
      <div
        className={`app-shell ${isChat ? 'is-chat' : ''} ${navCollapsed ? 'is-nav-collapsed' : ''}`}
      >
        <a className="skip-link" href="#main-content">
          {t('Skip to content')}
        </a>
        <aside className="sidebar">{nav}</aside>
        <div className="mobile-header">
          <Brand />
          <div className="row">
            <CheckinButton iconOnly />
            <Button
              variant="ghost"
              className="icon-button"
              aria-label={t('Open navigation')}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </Button>
          </div>
        </div>
        <Modal open={mobileOpen} onClose={() => setMobileOpen(false)} title={t('Your space')}>
          <div className="mobile-nav">{nav}</div>
        </Modal>
        <main
          id="main-content"
          className={`workspace ${isStudio ? 'workspace-studio' : ''}`}
          tabIndex={-1}
        >
          {!isChat && (
            <div className="frontend-entry-toolbar">
              <AnnouncementButton />
              <FrontendEntry workspace />
            </div>
          )}
          <div key={location.pathname} className="workspace-route">
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
        <Modal
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          title={t('A good place to start')}
        >
          <div className="stack help-links">
            <Link to="/chat" onClick={() => setHelpOpen(false)}>
              <MessageCircle />
              <span>
                <strong>{t('Ask your first question')}</strong>
                <small>{t('Choose a model and start a conversation.')}</small>
              </span>
              <ArrowIcon />
            </Link>
            <Link to="/studio" onClick={() => setHelpOpen(false)}>
              <ImagePlus />
              <span>
                <strong>{t('Create your first image')}</strong>
                <small>{t('Describe your idea and review the price before creating.')}</small>
              </span>
              <ArrowIcon />
            </Link>
            <Link to="/model-pricing" onClick={() => setHelpOpen(false)}>
              <Boxes />
              <span>
                <strong>{t('Find your service plan')}</strong>
                <small>{t('Compare models and transparent pricing.')}</small>
              </span>
              <ArrowIcon />
            </Link>
          </div>
        </Modal>
      </div>
    </CheckinProvider>
  )
}
function ArrowIcon() {
  return <ChevronRight size={17} />
}

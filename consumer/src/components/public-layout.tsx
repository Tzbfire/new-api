import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ArrowUpRight, LoaderCircle, Menu, PanelsTopLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/lib/session'
import { AnnouncementButton } from '@/features/announcements'
import { Brand } from './brand'
import { FrontendEntry } from './frontend-entry'
import { Preferences } from './preferences'
import { Button, Modal } from './ui'
import './public-layout.css'

const publicLinks = [
  { to: '/explore', label: 'Models and pricing' },
  { to: '/chat', label: 'AI chat' },
  { to: '/studio', label: 'Image studio' },
] as const

export function PublicHeader() {
  const { t } = useTranslation()
  const session = useSession()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])
  const navigation = (
    <nav aria-label={t('Main navigation')} className="public-links">
      {publicLinks.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={() => setOpen(false)}
          activeProps={{ className: 'active', 'aria-current': 'page' }}
        >
          {t(item.label)}
        </Link>
      ))}
    </nav>
  )
  const tools = (
    <div className="public-tools">
      <FrontendEntry />
      <AnnouncementButton />
      <Preferences />
    </div>
  )
  let accountAction = (
    <Link to="/login" className="button button-primary public-account">
      {t('Sign in')}
      <ArrowUpRight size={16} aria-hidden />
    </Link>
  )
  if (session.status === 'loading' && !session.authenticationError) {
    accountAction = (
      <span className="landing-session-loading" role="status">
        <LoaderCircle className="spin" size={16} aria-hidden />
        {t('Restoring your session…')}
      </span>
    )
  } else if (session.status === 'authenticated' && session.user) {
    accountAction = (
      <Link to="/chat" className="button button-primary public-account">
        <PanelsTopLeft size={16} aria-hidden />
        <span>{t('Open workspace')}</span>
      </Link>
    )
  }
  return (
    <>
      <a className="skip-link" href="#main-content">
        {t('Skip to content')}
      </a>
      <header className="public-header" aria-label={t('Main navigation')}>
        <Brand />
        <div className="public-desktop-links">{navigation}</div>
        <div className="public-actions">
          <div className="public-desktop-tools">{tools}</div>
          {accountAction}
          <Button
            variant="ghost"
            className="icon-button public-menu-toggle"
            aria-label={t('Open navigation')}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu size={21} aria-hidden />
          </Button>
        </div>
      </header>
      <Modal open={open} onClose={() => setOpen(false)} title={t('Main navigation')}>
        <div className="public-mobile-menu">
          {navigation}
          {tools}
        </div>
      </Modal>
    </>
  )
}

export function PublicFooter() {
  const { t } = useTranslation()
  return (
    <footer className="landing-footer">
      <Brand />
      <span>{t('Your models. Your tools. One gateway.')}</span>
      <span>Powered by New API · QuantumNous</span>
    </footer>
  )
}

export function PublicLayout(props: { children: ReactNode }) {
  return (
    <div className="public-site">
      <PublicHeader />
      <main id="main-content" className="public-main" tabIndex={-1}>
        {props.children}
      </main>
      <PublicFooter />
    </div>
  )
}

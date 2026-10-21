import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { resolveSiteBrand } from '@/lib/brand'
import { useStatus } from '@/lib/status'
import { useSiteBrand } from '@/lib/use-site-brand'

export function SiteMark() {
  const brand = useSiteBrand()
  const [failedLogo, setFailedLogo] = useState('')
  if (brand.logo && failedLogo !== brand.logo)
    return (
      <img
        className="site-mark"
        src={brand.logo}
        alt=""
        onError={() => setFailedLogo(brand.logo)}
      />
    )
  return (
    <svg className="site-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="12" fill="currentColor" />
      <path
        d="m12 15 8-5 8 5v10l-8 5-8-5Zm0 0 8 5 8-5M20 20v10"
        fill="none"
        stroke="#fffaf3"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SiteMetadata() {
  const status = useStatus()
  const brand = resolveSiteBrand(status.data)
  const serverName = document
    .querySelector<HTMLMetaElement>('meta[name="new-api-system-name"]')
    ?.content.trim()
  // Server-rendered titles follow system settings even when assets have build branding.
  const title =
    serverName === undefined ? brand.title : status.data?.system_name?.trim() || serverName
  const titleReady = Boolean(
    serverName !== undefined ||
    status.data ||
    process.env.PUBLIC_SITE_TITLE?.trim() ||
    process.env.PUBLIC_SITE_NAME?.trim(),
  )
  useEffect(() => {
    if (titleReady && title) document.title = title
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', `${brand.description} Powered by New API · QuantumNous.`)
    document.querySelector('link[rel="icon"]')?.setAttribute('href', brand.logo || '/favicon.svg')
  }, [titleReady, title, brand.description, brand.logo])
  return null
}

export function Brand() {
  const { t } = useTranslation()
  const siteBrand = useSiteBrand()
  const suffix = siteBrand.domain.toLowerCase().startsWith(`${siteBrand.name.toLowerCase()}.`)
    ? siteBrand.domain.slice(siteBrand.name.length)
    : ''
  return (
    <Link to="/" className="brand" aria-label={`${siteBrand.name} · ${t('AI model platform')}`}>
      <SiteMark />
      <span className="site-wordmark">
        <span>
          {siteBrand.name}
          {suffix && <span className="site-domain">{suffix}</span>}
        </span>
        <small>{t('AI model platform')}</small>
      </span>
    </Link>
  )
}

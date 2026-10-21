import type { SiteStatus } from './status'

/** Deployment presentation is separate from New API / QuantumNous attribution. */
export function resolveSiteBrand(status?: SiteStatus) {
  const name = process.env.PUBLIC_SITE_NAME?.trim() || status?.system_name?.trim() || 'New API'
  let domain = process.env.PUBLIC_SITE_DOMAIN?.trim() || ''
  if (!domain && status?.server_address) {
    try {
      const address = new URL(status.server_address)
      if (['https:', 'http:'].includes(address.protocol)) domain = address.host
    } catch {
      // An unset or invalid server address is not a public domain label.
    }
  }
  const logoURL = process.env.PUBLIC_SITE_LOGO_URL?.trim() || status?.logo?.trim() || ''
  const safeLogo =
    /^\/(?!\/)/.test(logoURL) || /^https?:\/\//i.test(logoURL) || /^data:image\//i.test(logoURL)
  return {
    name,
    domain,
    title: process.env.PUBLIC_SITE_TITLE?.trim() || name,
    description:
      process.env.PUBLIC_SITE_DESCRIPTION?.trim() ||
      'Access AI models through one API. Chat, create images and manage your usage.',
    logo: safeLogo ? logoURL : '',
  }
}

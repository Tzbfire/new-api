import type { SiteStatus } from '@/lib/status'

export interface APIAddress {
  url: string
  label: string
  description: string
}

/** Only administrator-published gateways, with no credentials or query secrets. */
export function normalizeAPIAddress(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.username || url.password || url.search || url.hash) return null
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      return null
    return url.href.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function apiAddresses(status: SiteStatus | undefined, origin: string): APIAddress[] {
  const addresses: APIAddress[] = []
  if (status?.api_info_enabled !== false && Array.isArray(status?.api_info)) {
    for (const entry of status.api_info) {
      if (!entry || typeof entry.url !== 'string') continue
      const url = normalizeAPIAddress(entry.url)
      if (!url || addresses.some((item) => item.url === url)) continue
      addresses.push({
        url,
        label: typeof entry.route === 'string' ? entry.route : '',
        description: typeof entry.description === 'string' ? entry.description : '',
      })
    }
  }
  if (addresses.length) return addresses
  const url = normalizeAPIAddress(status?.server_address || '') || normalizeAPIAddress(origin)
  return url ? [{ url, label: '', description: '' }] : []
}

/** Published addresses may already include the protocol suffix. Preserve proxy prefixes. */
export function protocolBaseURL(address: string, protocol: 'openai' | 'native'): string {
  const url = normalizeAPIAddress(address)
  if (!url) throw new Error('Choose a valid API address.')
  const root = url.replace(/\/v1(?:beta)?$/i, '')
  return protocol === 'openai' ? `${root}/v1` : root
}

// CC Switch v4.0.18 provider imports. The application-management list is broader
// than the provider deep-link allowlist; keep these aligned with its parser.
export const ccSwitchApps = {
  codex: { label: 'Codex', protocol: 'openai', apiFormat: 'openai_responses' },
  claude: { label: 'Claude Code', protocol: 'native', apiFormat: 'anthropic' },
  gemini: { label: 'Gemini CLI', protocol: 'native', apiFormat: 'gemini_native' },
  agy: { label: 'Antigravity CLI', protocol: 'native', apiFormat: 'gemini_native' },
  grokbuild: { label: 'Grok Build', protocol: 'openai', apiFormat: 'openai_responses' },
  opencode: { label: 'OpenCode', protocol: 'openai', apiFormat: 'openai_chat' },
  openclaw: { label: 'OpenClaw', protocol: 'openai', apiFormat: 'openai_chat' },
  hermes: { label: 'Hermes', protocol: 'openai', apiFormat: 'openai_chat' },
  pi: { label: 'Pi', protocol: 'openai', apiFormat: 'openai_chat' },
} as const

export type CCSwitchApp = keyof typeof ccSwitchApps

export function ccSwitchBaseURL(address: string, app: CCSwitchApp): string {
  return protocolBaseURL(address, ccSwitchApps[app].protocol)
}

export function ccSwitchLink(input: {
  app: CCSwitchApp
  name: string
  address: string
  model: string
  key: string
}): string {
  const params = new URLSearchParams({
    resource: 'provider',
    app: input.app,
    name: input.name,
    endpoint: ccSwitchBaseURL(input.address, input.app),
    apiKey: input.key.startsWith('sk-') ? input.key : `sk-${input.key}`,
    model: input.model,
    apiFormat: ccSwitchApps[input.app].apiFormat,
    enabled: 'false',
  })
  return `ccswitch://v1/import?${params.toString()}`
}

import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { resolveAuthentication } from './api'
import { safeLoginDestination } from './auth-navigation'
import { getAuthSnapshot } from './auth-state'
import { statusQueryOptions } from './status'

export async function requireAuthentication(input: { location: { href: string } }) {
  if (!(await resolveAuthentication({ required: true }))) {
    throw redirect({
      to: '/login',
      search: { next: safeLoginDestination(input.location.href) },
      replace: true,
    })
  }
  return { sessionId: getAuthSnapshot().session?.sid }
}

export async function requireGuest(input: { search: { next?: string } }) {
  let authenticated = false
  try {
    authenticated = await resolveAuthentication({ required: true })
  } catch {
    // A recovery outage must not prevent explicit sign-in or account recovery.
    return
  }
  if (authenticated)
    throw redirect({ href: safeLoginDestination(input.search.next || '/chat'), replace: true })
}

// These flags follow HeaderNavModules' existing API contract. The pricing
// endpoints continue to enforce module access and permissions on the server.
function moduleFlag(value: unknown, fallback: boolean) {
  if (typeof value === 'string') value = value.trim().toLowerCase()
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  return fallback
}

export async function requirePricingAccess(input: {
  context: { queryClient: QueryClient }
  location: { href: string }
}) {
  const status = await input.context.queryClient.fetchQuery({ ...statusQueryOptions, retry: false })
  let modules: unknown = status.HeaderNavModules
  if (typeof modules === 'string') {
    try {
      modules = JSON.parse(modules)
    } catch {
      modules = null
    }
  }
  const pricing =
    modules && typeof modules === 'object' && 'pricing' in modules ? modules.pricing : undefined
  let enabled = true
  let requireAuth = false
  if (pricing && typeof pricing === 'object') {
    if ('enabled' in pricing) enabled = moduleFlag(pricing.enabled, true)
    if ('requireAuth' in pricing) requireAuth = moduleFlag(pricing.requireAuth, false)
  } else enabled = moduleFlag(pricing, true)
  if (!enabled) throw redirect({ to: '/', replace: true })
  if (requireAuth) return requireAuthentication(input)
}

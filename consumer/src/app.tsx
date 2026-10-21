import { Suspense, lazy, useEffect, useRef, type ReactNode } from 'react'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useRouter,
  useLocation,
  redirect,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AppShell } from '@/components/shell'
import { PublicLayout } from '@/components/public-layout'
import type { QueryClient } from '@tanstack/react-query'
import { LoadingState } from '@/components/ui'
import { useSession } from '@/lib/session'
import { requireAuthentication, requireGuest, requirePricingAccess } from '@/lib/route-guards'
import { queryClient } from '@/lib/query-client'
import { ProtectedRoute, GuestRoute, RouteError } from '@/components/route-guard'
import { paymentReturnSearch } from '@/features/wallet/payment-return'
import { CatalogProvider } from '@/lib/catalog'
import { AnnouncementsProvider } from '@/features/announcements'

function RouteCatalog(props: { children: ReactNode; scope?: string }) {
  const location = useLocation()
  const search = location.search as { group?: string; model?: string }
  return (
    <CatalogProvider
      scope={props.scope}
      intent={{
        key: `${location.pathname}:${location.searchStr}`,
        group: search.group,
        model: search.model,
      }}
    >
      {props.children}
    </CatalogProvider>
  )
}

function Root() {
  const session = useSession()
  const router = useRouter()
  const identity = `${session.status}:${session.sessionId || ''}`
  const previousIdentity = useRef(identity)
  useEffect(() => {
    if (previousIdentity.current === identity) return
    previousIdentity.current = identity
    void router.invalidate()
  }, [identity, router])
  return (
    <AnnouncementsProvider>
      <Suspense fallback={<LoadingState />}>
        <Outlet />
      </Suspense>
    </AnnouncementsProvider>
  )
}
function Workspace() {
  const session = useSession()
  if (session.authenticationError) return <RouteError error={session.authenticationError} />
  return (
    <RouteCatalog key={session.sessionId || 'anonymous'}>
      <AppShell />
    </RouteCatalog>
  )
}
function ModelDiscovery() {
  const session = useSession()
  return (
    <PublicLayout>
      {session.authenticationError ? (
        <RouteError error={session.authenticationError} />
      ) : (
        <RouteCatalog key={session.sessionId || 'anonymous'}>
          <Outlet />
        </RouteCatalog>
      )}
    </PublicLayout>
  )
}
function NotFound() {
  const { t } = useTranslation()
  return (
    <div className="state">
      <h1>{t('A little off the beaten path.')}</h1>
      <p>{t('This page could not be found.')}</p>
      <Link to="/" className="button button-primary">
        {t('Back to home')}
      </Link>
    </div>
  )
}
const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    group?: string
    model?: string
    batch?: string
    request_id?: string
    from?: number
    token_id?: number
    token_label?: string
  } => ({
    group: typeof search.group === 'string' && search.group.length < 128 ? search.group : undefined,
    model: typeof search.model === 'string' && search.model.length < 256 ? search.model : undefined,
    batch: typeof search.batch === 'string' && search.batch.length < 128 ? search.batch : undefined,
    request_id:
      typeof search.request_id === 'string' && search.request_id.length <= 64
        ? search.request_id
        : undefined,
    from:
      Number.isSafeInteger(Number(search.from)) && Number(search.from) > 0
        ? Number(search.from)
        : undefined,
    token_id:
      Number.isSafeInteger(Number(search.token_id)) && Number(search.token_id) > 0
        ? Number(search.token_id)
        : undefined,
    token_label:
      typeof search.token_label === 'string' && search.token_label.length <= 128
        ? search.token_label
        : undefined,
  }),
  notFoundComponent: NotFound,
  errorComponent: RouteError,
})
const landing = createRoute({
  getParentRoute: () => root,
  path: '/',
  component: lazy(() => import('@/features/landing/LandingPage')),
})
const guestRoute = createRoute({
  getParentRoute: () => root,
  id: 'guest',
  beforeLoad: requireGuest,
  component: GuestRoute,
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === 'string' ? search.next : undefined,
  }),
})
const login = createRoute({
  getParentRoute: () => guestRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === 'string' ? search.next : undefined,
  }),
  component: lazy(() => import('@/features/auth/login')),
})
const register = createRoute({
  getParentRoute: () => guestRoute,
  path: '/register',
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === 'string' ? search.next : undefined,
  }),
  component: lazy(() => import('@/features/auth/register')),
})
const reset = createRoute({
  getParentRoute: () => root,
  path: '/reset',
  component: lazy(() => import('@/features/auth/reset')),
})
const legacyReset = createRoute({
  getParentRoute: () => root,
  path: '/app/reset',
  component: lazy(() => import('@/features/auth/reset')),
})
const oauthCallback = createRoute({
  getParentRoute: () => root,
  path: '/app/oauth/$provider',
  component: lazy(() => import('@/features/auth/oauth-callback')),
})
const publicShell = createRoute({
  getParentRoute: () => root,
  id: 'discovery',
  component: ModelDiscovery,
  beforeLoad: requirePricingAccess,
})
const ExplorePage = lazy(() => import('@/features/explore/ExplorePage'))
const explore = createRoute({
  getParentRoute: () => publicShell,
  path: '/explore',
  component: ExplorePage,
})
const protectedRoute = createRoute({
  getParentRoute: () => root,
  id: 'authenticated',
  beforeLoad: requireAuthentication,
  component: ProtectedRoute,
  errorComponent: RouteError,
})
const shell = createRoute({
  getParentRoute: () => protectedRoute,
  id: 'workspace',
  component: Workspace,
})
const modelPricing = createRoute({
  getParentRoute: () => shell,
  path: '/model-pricing',
  beforeLoad: requirePricingAccess,
  component: ExplorePage,
})
const ChatPage = lazy(() => import('@/features/chat/ChatPage'))
const StudioPage = lazy(() => import('@/features/studio/StudioPage'))
const LibraryPage = lazy(() => import('@/features/studio/LibraryPage'))
const chat = createRoute({
  getParentRoute: () => shell,
  path: '/chat',
  component: () => (
    <RouteCatalog scope="chat">
      <ChatPage />
    </RouteCatalog>
  ),
})
const studio = createRoute({
  getParentRoute: () => shell,
  path: '/studio',
  component: () => (
    <RouteCatalog scope="studio">
      <StudioPage />
    </RouteCatalog>
  ),
})
const library = createRoute({
  getParentRoute: () => shell,
  path: '/library',
  component: () => (
    <RouteCatalog scope="studio">
      <LibraryPage />
    </RouteCatalog>
  ),
})
const KeysPage = lazy(() => import('@/features/keys/KeysPage'))
const keys = createRoute({
  getParentRoute: () => shell,
  path: '/keys',
  component: () => (
    <RouteCatalog scope="keys">
      <KeysPage />
    </RouteCatalog>
  ),
})
const UsagePage = lazy(() => import('@/features/usage/UsagePage'))
function UsageRoute() {
  const location = useLocation()
  const search = location.search as {
    request_id?: string
    from?: number
    token_id?: number
    token_label?: string
  }
  return (
    <UsagePage
      key={`${search.request_id || ''}:${search.from || ''}:${search.token_id || ''}`}
      initialRequestId={search.request_id}
      initialFrom={search.from}
      initialTokenId={search.token_id}
      initialTokenName={search.token_label}
    />
  )
}
const usage = createRoute({
  getParentRoute: () => shell,
  path: '/usage',
  component: UsageRoute,
})
const wallet = createRoute({
  getParentRoute: () => shell,
  path: '/wallet',
  validateSearch: paymentReturnSearch,
  beforeLoad: ({ search }) => {
    if (search.show_history)
      throw redirect({ to: '/orders', search: { pay: search.pay }, replace: true })
  },
  component: lazy(() => import('@/features/wallet/WalletPage')),
})
const plans = createRoute({
  getParentRoute: () => shell,
  path: '/plans',
  component: lazy(() => import('@/features/wallet/PlansPage')),
})
const orders = createRoute({
  getParentRoute: () => shell,
  path: '/orders',
  validateSearch: paymentReturnSearch,
  component: lazy(() => import('@/features/wallet/OrdersPage')),
})
const account = createRoute({
  getParentRoute: () => shell,
  path: '/account',
  component: lazy(() => import('@/features/account')),
})
const studioAlias = createRoute({
  getParentRoute: () => shell,
  path: '/image-studio',
  component: studio.options.component,
})
const accountAlias = createRoute({
  getParentRoute: () => shell,
  path: '/profile',
  component: account.options.component,
})
const routeTree = root.addChildren([
  landing,
  guestRoute.addChildren([login, register]),
  reset,
  legacyReset,
  oauthCallback,
  publicShell.addChildren([explore]),
  protectedRoute.addChildren([
    shell.addChildren([
      modelPricing,
      chat,
      studio,
      library,
      keys,
      usage,
      wallet,
      plans,
      orders,
      account,
      studioAlias,
      accountAlias,
    ]),
  ]),
])
export const router = createRouter({
  routeTree,
  context: { queryClient },
  basepath: '/',
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultPendingComponent: LoadingState,
})
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

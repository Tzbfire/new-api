import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request, rawRequest } from './api'
import { useSession } from './session'
import { readPreference, savePreference } from './preferences'

export interface PricingModel {
  model_name: string
  description?: string
  vendor_id?: number
  owner_by?: string
  tags?: string
  supported_endpoint_types: string[]
  enable_groups?: string[]
  billing_mode?: string
  billing_expr?: string
  quota_type?: number
}
export interface ServiceGroup {
  id: string
  desc: string
  ratio: number | 'auto'
  display_order?: number
}
interface PricingResponse {
  data: PricingModel[]
  usable_group: Record<string, string>
  group_ratio: Record<string, number>
  group_order?: string[]
  auto_groups?: string[]
  vendors?: Array<{ id: number; name: string }>
  supported_endpoint?: Record<string, { path?: string; method?: string }>
}
const CatalogContext = createContext<ReturnType<typeof useCatalogData> | null>(null)
export interface CatalogIntent {
  key: string
  group?: string
  model?: string
}
function useCatalogData(scope: string, intent?: CatalogIntent) {
  const { user, status } = useSession()
  const intentKey = intent?.key || 'default'
  const requestedGroup = intent?.group || ''
  const requestedModel = intent?.model || ''
  const identity = user?.id || 'public'
  const preferenceKey = `${identity}:${scope}:group`
  const [selection, setSelection] = useState({ intentKey: '', value: '' })
  const pricing = useQuery({
    queryKey: ['catalog', identity],
    queryFn: async () =>
      (await rawRequest<PricingModel[]>('/api/pricing')) as unknown as PricingResponse,
    enabled: status !== 'loading',
    staleTime: 60_000,
  })
  const groupQuery = useQuery({
    queryKey: ['service-groups', identity],
    queryFn: () => request<Record<string, Omit<ServiceGroup, 'id'>>>('/api/user/self/groups'),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  })
  const publicOrder = new Map(pricing.data?.group_order?.map((id, index) => [id, index]))
  const publicGroups = Object.entries(pricing.data?.usable_group || {}).map(([id, desc]) => ({
    id,
    desc,
    ratio: pricing.data?.group_ratio[id] ?? ('auto' as const),
    display_order: publicOrder.get(id),
  }))
  const groups = (
    status === 'authenticated'
      ? Object.entries(groupQuery.data || {}).map(([id, value]) => ({ id, ...value }))
      : publicGroups
  ).sort(
    (a, b) =>
      (a.display_order ?? Number.MAX_SAFE_INTEGER) - (b.display_order ?? Number.MAX_SAFE_INTEGER),
  )
  const preferred =
    groups.find((g) => g.id === user?.group) ||
    groups.find((g) => g.id === 'default') ||
    groups.find((g) => g.id !== 'auto') ||
    groups[0]
  const chosen =
    selection.intentKey === intentKey
      ? selection.value
      : requestedGroup || readPreference(preferenceKey)
  const group = groups.some((g) => g.id === chosen) ? chosen! : preferred?.id || ''
  useEffect(() => {
    if (group) savePreference(preferenceKey, group)
  }, [group, preferenceKey])
  const allowed = useQuery({
    queryKey: ['allowed-models', identity, group],
    queryFn: () => request<string[]>(`/api/user/models?group=${encodeURIComponent(group)}`),
    enabled: status === 'authenticated' && !!group,
    staleTime: 30_000,
  })
  const rows = pricing.data?.data || []
  const permitted = new Set(allowed.data || [])
  const models = rows.filter((model) => {
    if (status === 'authenticated') return permitted.has(model.model_name)
    if (model.enable_groups?.includes('all')) return true
    if (group === 'auto')
      return model.enable_groups?.some((g) => pricing.data?.auto_groups?.includes(g))
    return model.enable_groups?.includes(group)
  })
  return {
    group,
    intentKey,
    requestedModel: !requestedGroup || requestedGroup === group ? requestedModel : '',
    setGroup: (id: string) => {
      if (!groups.some((group) => group.id === id)) return
      setSelection({ intentKey, value: id })
      savePreference(preferenceKey, id)
    },
    groups,
    models,
    allModels: rows,
    vendors: pricing.data?.vendors || [],
    autoGroups: pricing.data?.auto_groups || [],
    endpoints: pricing.data?.supported_endpoint || {},
    metadataPending: pricing.isPending || (status === 'authenticated' && groupQuery.isPending),
    metadataError: pricing.error || groupQuery.error,
    accessPending: status === 'authenticated' && !!group && allowed.isPending,
    accessError: status === 'authenticated' ? allowed.error : null,
    isPending:
      pricing.isPending ||
      (status === 'authenticated' && (groupQuery.isPending || (!!group && allowed.isPending))),
    error: pricing.error || groupQuery.error || allowed.error,
    refetch: () => {
      void pricing.refetch()
      if (status === 'authenticated') {
        void groupQuery.refetch()
        if (group) void allowed.refetch()
      }
    },
  }
}
function CatalogScope(props: { children: ReactNode; scope: string; intent?: CatalogIntent }) {
  const value = useCatalogData(props.scope, props.intent)
  return <CatalogContext.Provider value={value}>{props.children}</CatalogContext.Provider>
}
export function CatalogProvider(props: {
  children: ReactNode
  scope?: string
  intent?: CatalogIntent
}) {
  const { user } = useSession()
  const scope = props.scope || 'catalog'
  return (
    <CatalogScope key={`${user?.id || 'public'}:${scope}`} scope={scope} intent={props.intent}>
      {props.children}
    </CatalogScope>
  )
}
export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('CatalogProvider is missing')
  return ctx
}

export function safeLoginDestination(value: string | null) {
  const destinations = [
    '/explore',
    '/model-pricing',
    '/keys',
    '/wallet',
    '/plans',
    '/orders',
    '/usage',
    '/studio',
    '/library',
    '/chat',
    '/account',
  ] as const
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value))
    return '/explore'
  let url: URL
  try {
    const decoded = decodeURIComponent(value)
    if (
      decoded.includes('\\') ||
      Array.from(decoded).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      return '/explore'
    url = new URL(value, 'https://consumer.invalid')
  } catch {
    return '/explore'
  }
  const aliases: Record<string, string> = { '/image-studio': '/studio', '/profile': '/account' }
  const pathname = aliases[url.pathname] || url.pathname
  let path = destinations.find((path) => path === pathname)
  if (!path || url.origin !== 'https://consumer.invalid') return '/explore'
  const params = new URLSearchParams()
  const group = url.searchParams.get('group')
  const model = url.searchParams.get('model')
  if (group && group.length < 128) params.set('group', group)
  if (model && model.length < 256) params.set('model', model)
  const batch = url.searchParams.get('batch')
  if (batch && batch.length < 128) params.set('batch', batch)
  const requestId = url.searchParams.get('request_id')
  const from = url.searchParams.get('from')
  const pay = url.searchParams.get('pay')
  if (requestId && /^[A-Za-z0-9_-]{1,64}$/.test(requestId)) params.set('request_id', requestId)
  if (from && /^\d+$/.test(from) && Number.isSafeInteger(Number(from)) && Number(from) > 0)
    params.set('from', String(Number(from)))
  if (pay === 'success' || pay === 'fail' || pay === 'pending') params.set('pay', pay)
  if (path === '/wallet' && url.searchParams.get('show_history') === 'true') path = '/orders'
  const hash = ['#studio-creations', '#orders', '#details', '#main-content'].includes(url.hash)
    ? url.hash
    : ''
  return `${path}${params.size ? `?${params}` : ''}${hash}`
}

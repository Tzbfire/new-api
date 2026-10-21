import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { SessionProvider } from '@/lib/session'
import { queryClient } from '@/lib/query-client'
import { router } from './app'
import { SiteMetadata } from '@/components/brand'
import './i18n'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <SiteMetadata />
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </QueryClientProvider>,
)

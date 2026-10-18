/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import { ArrowRight, Check, Layers3, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useStatus } from '@/hooks/use-status'
import { formatQuota } from '@/lib/format'
import { getModuleAccessFromStatus } from '@/lib/nav-modules'

import { getPublicSubscriptionPlans } from '../../api'
import type { PublicSubscriptionPlan } from '../../types'

type OffersProps = {
  isAuthenticated?: boolean
}

function formatPlanPrice(plan: PublicSubscriptionPlan): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: plan.currency || 'USD',
      maximumFractionDigits: 6,
    }).format(plan.price_amount)
  } catch {
    return `${plan.currency || 'USD'} ${plan.price_amount}`
  }
}

function formatPlanDuration(
  plan: PublicSubscriptionPlan,
  t: (key: string) => string
): string {
  if (plan.duration_unit === 'custom') {
    const seconds = plan.custom_seconds || 0
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${t('days')}`
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${t('hours')}`
    return `${seconds} ${t('seconds')}`
  }
  const labels: Record<string, string> = {
    year: t('years'),
    month: t('months'),
    day: t('days'),
    hour: t('hours'),
  }
  return `${plan.duration_value || 1} ${labels[plan.duration_unit] || plan.duration_unit}`
}

function formatPlanReset(
  plan: PublicSubscriptionPlan,
  t: (key: string) => string
): string {
  if (plan.quota_reset_period === 'daily') return t('Daily reset')
  if (plan.quota_reset_period === 'weekly') return t('Weekly reset')
  if (plan.quota_reset_period === 'monthly') return t('Monthly reset')
  if (plan.quota_reset_period === 'custom') return t('Custom quota reset')
  return t('No quota reset')
}

function formatPlanGroups(
  plan: PublicSubscriptionPlan,
  t: (key: string) => string
): string {
  const groups = (plan.allowed_token_groups || '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean)
  return groups.length > 0 ? groups.join(', ') : t('All groups')
}

export function Offers(props: OffersProps) {
  const { t } = useTranslation()
  const { status, loading: isStatusLoading } = useStatus()
  const pricingAccess = getModuleAccessFromStatus(
    status as Record<string, unknown> | null,
    'pricing'
  )
  const canShowPlans =
    pricingAccess.enabled &&
    (!pricingAccess.requireAuth || Boolean(props.isAuthenticated))
  const [plans, setPlans] = useState<PublicSubscriptionPlan[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    if (isStatusLoading) return
    if (!canShowPlans) {
      setPlans([])
      setIsLoaded(true)
      return
    }
    let active = true
    getPublicSubscriptionPlans()
      .then((result) => {
        if (active) {
          setPlans(result.slice(0, 3))
          setIsLoaded(true)
        }
      })
      .catch(() => {
        if (active) {
          setPlans([])
          setIsLoaded(true)
        }
      })
    return () => {
      active = false
    }
  }, [canShowPlans, isStatusLoading])

  if (isStatusLoading || !canShowPlans || !isLoaded || plans.length === 0) {
    return null
  }

  return (
    <section className='relative z-10 px-6 py-20 md:py-28'>
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mx-auto mb-12 max-w-2xl text-center'>
          <Badge variant='outline' className='mb-4'>
            {t('Plans')}
          </Badge>
          <h2 className='text-2xl font-bold tracking-tight md:text-4xl'>
            {t('Start with a plan that fits your workload')}
          </h2>
          <p className='text-muted-foreground mx-auto mt-4 max-w-xl leading-relaxed'>
            {t(
              'Choose from currently available plans, then manage usage and billing in one place.'
            )}
          </p>
        </AnimateInView>

        <div className='grid gap-5 md:grid-cols-3'>
          {plans.map((plan, index) => (
            <AnimateInView key={plan.id} delay={index * 70}>
              <Card className='border-border/60 bg-card/80 h-full backdrop-blur-sm'>
                <CardHeader>
                  <div className='flex items-start justify-between gap-3'>
                    <div>
                      <CardTitle>{plan.title}</CardTitle>
                      {plan.subtitle && (
                        <CardDescription className='mt-2'>
                          {plan.subtitle}
                        </CardDescription>
                      )}
                    </div>
                    {plan.upgrade_group && (
                      <Badge variant='secondary'>{plan.upgrade_group}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className='flex-1 space-y-5'>
                  <div>
                    <span className='text-3xl font-bold tracking-tight'>
                      {formatPlanPrice(plan)}
                    </span>
                    <span className='text-muted-foreground ml-2 text-sm'>
                      / {formatPlanDuration(plan, t)}
                    </span>
                  </div>
                  <div className='text-muted-foreground space-y-3 text-sm'>
                    <div className='flex items-center gap-2'>
                      <Check className='size-4 text-emerald-500' />
                      <span>
                        {plan.total_amount > 0
                          ? t('{{quota}} included quota', {
                              quota: formatQuota(plan.total_amount),
                            })
                          : t('Unlimited plan quota')}
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <RefreshCw className='size-4 text-blue-500' />
                      <span>{formatPlanReset(plan, t)}</span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Layers3 className='size-4 text-violet-500' />
                      <span>
                        {t('Available groups: {{groups}}', {
                          groups: formatPlanGroups(plan, t),
                        })}
                      </span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    className='group w-full'
                    data-umami-event='home-plan-cta'
                    render={
                      props.isAuthenticated ? (
                        <Link to='/wallet' />
                      ) : (
                        <Link to='/sign-in' search={{ redirect: '/wallet' }} />
                      )
                    }
                  >
                    {t('Choose this plan')}
                    <ArrowRight className='transition-transform group-hover:translate-x-0.5' />
                  </Button>
                </CardFooter>
              </Card>
            </AnimateInView>
          ))}
        </div>

        <AnimateInView className='mt-9 flex justify-center' animation='fade-in'>
          <Button
            variant='outline'
            data-umami-event={
              props.isAuthenticated ? 'home-pricing-view' : 'home-signup-cta'
            }
            render={
              props.isAuthenticated ? (
                <Link to='/wallet' />
              ) : (
                <Link to='/sign-in' search={{ redirect: '/wallet' }} />
              )
            }
          >
            {props.isAuthenticated
              ? t('Manage plans and balance')
              : t('Sign in to get started')}
          </Button>
        </AnimateInView>
      </div>
    </section>
  )
}

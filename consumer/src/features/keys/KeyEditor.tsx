import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import ipaddr from 'ipaddr.js'
import { useTranslation } from 'react-i18next'
import { KeyModelsDialog } from './KeyModelsDialog'
import { KeyExpiration } from './KeyExpiration'
import { SearchSelect } from '@/components/search-select'
import { Button, Checkbox, ErrorState, Field, Input, Modal, Textarea } from '@/components/ui'
import { request } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { formatMoney } from '@/lib/format'
import { toIntlLocale } from '@/i18n/languages'
import { useStatus } from '@/lib/status'
import type { APIKey } from './types'

export function KeyEditor(props: {
  existing: APIKey | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const catalog = useCatalog()
  const site = useStatus()
  const [name, setName] = useState(props.existing?.name || '')
  const [unlimited, setUnlimited] = useState(props.existing?.unlimited_quota ?? false)
  const [budgetChoice, setBudget] = useState<string | null>(null)
  const budget =
    budgetChoice ??
    (site.data?.quota_per_unit
      ? String(props.existing ? props.existing.remain_quota / site.data.quota_per_unit : 10)
      : '')
  const [expiry, setExpiry] = useState(
    props.existing?.expired_time && props.existing.expired_time !== -1
      ? new Date(props.existing.expired_time * 1000)
          .toLocaleString('sv-SE')
          .replace(' ', 'T')
          .slice(0, 16)
      : '',
  )
  const [expiryChanged, setExpiryChanged] = useState(false)
  const [ips, setIps] = useState(props.existing?.allow_ips || '')
  const [modelLimits, setModelLimits] = useState(props.existing?.model_limits || '')
  const [limitsEnabled, setLimitsEnabled] = useState(props.existing?.model_limits_enabled || false)
  const [groupChanged, setGroupChanged] = useState(false)
  const [showPrices, setShowPrices] = useState(false)
  const [queryBalance, setQueryBalance] = useState(props.existing?.allow_user_quota_query ?? false)
  const [validation, setValidation] = useState('')
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request('/api/token/', {
        method: props.existing ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: props.onSaved,
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    setValidation('')
    const quota = Math.round(Number(budget) * (site.data?.quota_per_unit || 0))
    const invalidIP = ips
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
      .some((value) => {
        try {
          const address = value.split('/')[0]
          if (address.includes('%')) return true
          if (address.includes(':')) {
            if (!ipaddr.IPv6.isValid(address)) return true
          } else if (!ipaddr.IPv4.isValidFourPartDecimal(address)) return true
          if (value.includes('/')) {
            ipaddr.parseCIDR(value)
            return false
          }
          return false
        } catch {
          return true
        }
      })
    if (
      !name.trim() ||
      new TextEncoder().encode(name.trim()).length > 50 ||
      (!unlimited && (!budget.trim() || !Number.isSafeInteger(quota) || quota < 0)) ||
      !catalog.group ||
      !catalog.groups.some((group) => group.id === catalog.group) ||
      (!unlimited && !site.data?.quota_per_unit) ||
      invalidIP
    ) {
      setValidation(
        invalidIP
          ? 'Enter a valid IP address or CIDR range on each line.'
          : 'Check the key name, service group, and spending limit.',
      )
      return
    }
    const expires =
      props.existing && !expiryChanged
        ? props.existing.expired_time
        : expiry
          ? Math.floor(new Date(expiry).getTime() / 1000)
          : -1
    if (expiryChanged && expiry && (!Number.isFinite(expires) || expires <= Date.now() / 1000)) {
      setValidation('Choose an expiration time in the future.')
      return
    }
    save.mutate({
      id: props.existing?.id,
      name: name.trim(),
      group: props.existing && !groupChanged ? props.existing.group : catalog.group,
      expired_time: expires,
      unlimited_quota: unlimited,
      remain_quota: unlimited ? props.existing?.remain_quota || 0 : quota,
      model_limits_enabled: limitsEnabled,
      model_limits: modelLimits.trim(),
      allow_ips: ips.trim(),
      allow_user_quota_query: queryBalance,
      cross_group_retry: props.existing?.cross_group_retry || false,
      auto_groups: props.existing?.auto_groups || null,
    })
  }
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t(props.existing ? 'Edit API key' : 'Create an API key')}
      description={t('Start with a name and a service group. You can adjust the rest anytime.')}
    >
      <form className="stack" onSubmit={submit}>
        <Field label={t('Key name')}>
          <Input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('My favorite app')}
          />
        </Field>
        <div className="stack">
          <SearchSelect
            value={catalog.group}
            onValueChange={(value) => {
              setGroupChanged(true)
              catalog.setGroup(value)
            }}
            options={catalog.groups.map((group) => ({
              value: group.id,
              label: group.id,
              description: `${group.desc} · ${group.ratio === 'auto' ? t('Automatic routing') : `${group.ratio}×`}`,
            }))}
            label={t('Service group')}
            searchPlaceholder={t('Search service groups')}
          />
          <p className="field-hint">
            {t('Model access and pricing come directly from your selected group.')}
          </p>
          <Button variant="secondary" onClick={() => setShowPrices(true)}>
            {t('View supported models and prices')}
          </Button>
        </div>
        <Field
          label={t(
            props.existing ? 'Remaining available key quota (USD)' : 'Key spending limit (USD)',
          )}
          hint={t(
            'This is the remaining amount this key can spend. Used quota is not reset. Your wallet balance still applies.',
          )}
        >
          <Input
            type="number"
            min="0"
            step="0.01"
            required={!unlimited}
            value={budget}
            disabled={unlimited || !site.data?.quota_per_unit}
            onChange={(event) => setBudget(event.target.value)}
          />
        </Field>
        {props.existing &&
          !unlimited &&
          !!site.data?.quota_per_unit &&
          Number.isFinite(Number(budget)) &&
          Number(budget) >= 0 && (
            <p className="field-hint" role="status">
              {t('Used: {{used}} · Total after saving: {{total}}', {
                used: formatMoney(
                  (props.existing.used_quota || 0) / (site.data?.quota_per_unit || 1),
                  'USD',
                  locale,
                ),
                total: formatMoney(
                  (props.existing.used_quota || 0) / (site.data?.quota_per_unit || 1) +
                    Number(budget),
                  'USD',
                  locale,
                ),
              })}
            </p>
          )}
        <label className="row">
          <Checkbox checked={unlimited} onCheckedChange={setUnlimited} />
          {t('No separate key limit')}
        </label>
        <details>
          <summary>{t('Advanced settings')}</summary>
          <div className="stack">
            <KeyExpiration
              value={expiry}
              onChange={(value) => {
                setExpiryChanged(true)
                setExpiry(value)
              }}
            />
            <Field
              label={t('Allowed models')}
              hint={t('Optional. Separate model names with commas.')}
            >
              <Textarea
                value={modelLimits}
                onChange={(event) => {
                  setModelLimits(event.target.value)
                  setLimitsEnabled(event.target.value.trim().length > 0)
                }}
              />
            </Field>
            <Field
              label={t('Allowed IP addresses')}
              hint={t('Optional. One address or CIDR range per line.')}
            >
              <Textarea value={ips} onChange={(event) => setIps(event.target.value)} />
            </Field>
            <label className="row">
              <Checkbox checked={queryBalance} onCheckedChange={setQueryBalance} />
              {t('Allow this key to query my wallet balance')}
            </label>
          </div>
        </details>
        {validation && (
          <p className="field-error" role="alert">
            {t(validation)}
          </p>
        )}
        {save.error && <ErrorState error={save.error} />}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={props.onClose} disabled={save.isPending}>
            {t('Cancel')}
          </Button>
          <Button
            type="submit"
            busy={save.isPending}
            disabled={catalog.isPending || !!catalog.error}
          >
            {t('Save key')}
          </Button>
        </div>
        <p className="muted">{t('Spending is enforced by the server.')}</p>
      </form>
      {showPrices && (
        <KeyModelsDialog
          group={catalog.group}
          modelLimits={limitsEnabled ? modelLimits : undefined}
          onClose={() => setShowPrices(false)}
        />
      )}
    </Modal>
  )
}

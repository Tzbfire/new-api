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
export type RateLimitRule = {
  group: string | null
  model: string | null
  maxRequests: number
  maxSuccess: number
}

export type RateLimitSelection = {
  groups: string[]
  models: string[]
  maxRequests: number
  maxSuccess: number
}

export type RateLimitOptions = {
  ModelRequestRateLimitCount: number
  ModelRequestRateLimitSuccessCount: number
  ModelRequestRateLimitGroup?: string
  ModelRequestRateLimitModel?: string
  ModelRequestRateLimitGroupModel?: string
}

type Limits = [number, number]
type FlatRules = Record<string, Limits>
type GroupModelRules = Record<string, FlatRules>

function parseRuleObject(value: string | undefined): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value?.trim() || '{}')
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid rate limit configuration')
  }
  return parsed as Record<string, unknown>
}

function parseLimits(value: unknown): Limits {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((count) => Number.isSafeInteger(count) && count >= 0)
  ) {
    throw new Error('Invalid rate limit configuration')
  }
  return [value[0], value[1]]
}

export function getRateLimitRuleKey(
  rule: Pick<RateLimitRule, 'group' | 'model'>
): string {
  return JSON.stringify([rule.group, rule.model])
}

export function rateLimitRulesFromOptions(
  options: RateLimitOptions
): RateLimitRule[] {
  const [maxRequests, maxSuccess] = parseLimits([
    options.ModelRequestRateLimitCount,
    options.ModelRequestRateLimitSuccessCount,
  ])
  const rules: RateLimitRule[] = [
    { group: null, model: null, maxRequests, maxSuccess },
  ]
  for (const [name, value] of Object.entries(
    parseRuleObject(options.ModelRequestRateLimitGroup)
  )) {
    const [total, success] = parseLimits(value)
    rules.push({
      group: name,
      model: null,
      maxRequests: total,
      maxSuccess: success,
    })
  }
  for (const [name, value] of Object.entries(
    parseRuleObject(options.ModelRequestRateLimitModel)
  )) {
    if (!name.trim()) throw new Error('Invalid rate limit configuration')
    const [total, success] = parseLimits(value)
    rules.push({
      group: null,
      model: name,
      maxRequests: total,
      maxSuccess: success,
    })
  }
  for (const [group, models] of Object.entries(
    parseRuleObject(options.ModelRequestRateLimitGroupModel)
  )) {
    if (!group.trim() || group !== group.trim()) {
      throw new Error('Invalid rate limit configuration')
    }
    if (!models || typeof models !== 'object' || Array.isArray(models)) {
      throw new Error('Invalid rate limit configuration')
    }
    for (const [model, value] of Object.entries(models)) {
      if (!model.trim() || model !== model.trim()) {
        throw new Error('Invalid rate limit configuration')
      }
      const [total, success] = parseLimits(value)
      rules.push({ group, model, maxRequests: total, maxSuccess: success })
    }
  }
  return rules
}

export function rateLimitOptionsFromRules(
  rules: RateLimitRule[],
  original: RateLimitOptions
): Required<RateLimitOptions> {
  const groups: FlatRules = Object.create(null)
  const models: FlatRules = Object.create(null)
  const groupModels: GroupModelRules = Object.create(null)
  // Empty group objects have no runtime effect, but retain them on round trips.
  for (const [group, values] of Object.entries(
    parseRuleObject(original.ModelRequestRateLimitGroupModel)
  )) {
    if (
      values &&
      typeof values === 'object' &&
      !Array.isArray(values) &&
      !Object.keys(values).length
    ) {
      groupModels[group] = Object.create(null)
    }
  }
  let global: Limits | undefined
  const keys = new Set<string>()
  for (const rule of rules) {
    const key = getRateLimitRuleKey(rule)
    if (keys.has(key)) throw new Error('Duplicate rate limit rule')
    keys.add(key)
    const counts = parseLimits([rule.maxRequests, rule.maxSuccess])
    if (rule.group === null && rule.model === null) global = counts
    else if (rule.group === null && rule.model !== null) {
      models[rule.model] = counts
    } else if (rule.group !== null && rule.model === null) {
      groups[rule.group] = counts
    } else if (rule.group !== null && rule.model !== null) {
      groupModels[rule.group] ??= Object.create(null)
      groupModels[rule.group][rule.model] = counts
    }
  }
  if (!global) throw new Error('Missing default rate limit rule')

  const result: Required<RateLimitOptions> = {
    ModelRequestRateLimitCount: global[0],
    ModelRequestRateLimitSuccessCount: global[1],
    ModelRequestRateLimitGroup: JSON.stringify(groups),
    ModelRequestRateLimitModel: JSON.stringify(models),
    ModelRequestRateLimitGroupModel: JSON.stringify(groupModels),
  }
  // Avoid rewriting untouched settings merely to change whitespace/key order.
  for (const key of [
    'ModelRequestRateLimitGroup',
    'ModelRequestRateLimitModel',
    'ModelRequestRateLimitGroupModel',
  ] as const) {
    const before = parseRuleObject(original[key])
    const after = parseRuleObject(result[key])
    const sameKeys = Object.keys(before).length === Object.keys(after).length
    const sameValues = Object.entries(before).every(([name, value]) => {
      if (!Object.hasOwn(after, name)) return false
      if (key !== 'ModelRequestRateLimitGroupModel') {
        return JSON.stringify(value) === JSON.stringify(after[name])
      }
      const beforeModels = value as Record<string, unknown>
      const afterModels = after[name] as Record<string, unknown>
      return (
        Object.keys(beforeModels).length === Object.keys(afterModels).length &&
        Object.entries(beforeModels).every(
          ([model, counts]) =>
            Object.hasOwn(afterModels, model) &&
            JSON.stringify(counts) === JSON.stringify(afterModels[model])
        )
      )
    })
    if (sameKeys && sameValues) result[key] = original[key] ?? ''
  }
  return result
}

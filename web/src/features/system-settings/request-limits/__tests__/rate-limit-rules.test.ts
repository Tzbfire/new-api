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
import { describe, expect, it } from 'vitest'

import {
  getRateLimitRuleKey,
  rateLimitOptionsFromRules,
  rateLimitRulesFromOptions,
  type RateLimitOptions,
} from '../lib/rate-limit-rules'

const defaults: Required<RateLimitOptions> = {
  ModelRequestRateLimitCount: 100,
  ModelRequestRateLimitSuccessCount: 80,
  ModelRequestRateLimitGroup: '',
  ModelRequestRateLimitModel: '',
  ModelRequestRateLimitGroupModel: '',
}

describe('legacy rate limit rule adapters', () => {
  it('round-trips all maps without rewriting whitespace, key order, or empty nested groups', () => {
    const options = {
      ...defaults,
      ModelRequestRateLimitGroup: ' { "vip": [9, 8], "default": [6, 5] } ',
      ModelRequestRateLimitModel: '\n{"gpt-6-luna":[4,3],"claude-3":[2,1]}\n',
      ModelRequestRateLimitGroupModel:
        '{ "unused": {}, "vip": { "gpt-6-luna": [0, 0], "claude-3": [7, 0] } }',
    }

    const rules = rateLimitRulesFromOptions(options)

    expect(rules).toHaveLength(7)
    expect(rateLimitOptionsFromRules(rules, options)).toEqual(options)
    expect(rateLimitOptionsFromRules(rules.toReversed(), options)).toEqual(
      options
    )
  })

  it('preserves empty legacy strings when no map has changed', () => {
    const rules = rateLimitRulesFromOptions(defaults)

    expect(rateLimitOptionsFromRules(rules, defaults)).toEqual(defaults)
  })

  it('preserves legacy flat group names and surrounding model whitespace without normalization', () => {
    const options = {
      ...defaults,
      ModelRequestRateLimitGroup: '{"": [1,0], " spaced ": [2,0]}',
      ModelRequestRateLimitModel: '{" gpt-6-luna ": [3,0]}',
    }

    const rules = rateLimitRulesFromOptions(options)

    expect(rules.map(getRateLimitRuleKey)).toEqual([
      '[null,null]',
      '["",null]',
      '[" spaced ",null]',
      '[null," gpt-6-luna "]',
    ])
    expect(rateLimitOptionsFromRules(rules, options)).toEqual(options)
  })

  it('keeps literal asterisks distinct from all groups and all models', () => {
    const options = {
      ...defaults,
      ModelRequestRateLimitGroup: '{"*":[10,9]}',
      ModelRequestRateLimitModel: '{"*":[8,7]}',
      ModelRequestRateLimitGroupModel: '{"*":{"*":[6,5]}}',
    }

    const rules = rateLimitRulesFromOptions(options)

    expect(rules.map(getRateLimitRuleKey)).toEqual([
      '[null,null]',
      '["*",null]',
      '[null,"*"]',
      '["*","*"]',
    ])
    expect(rateLimitOptionsFromRules(rules, options)).toEqual(options)
  })

  it('preserves prototype-related names when changed maps must be serialized', () => {
    const options = {
      ...defaults,
      ModelRequestRateLimitGroup: '{"__proto__":[1,0],"constructor":[2,0]}',
      ModelRequestRateLimitModel: '{"__proto__":[3,0],"constructor":[4,0]}',
      ModelRequestRateLimitGroupModel:
        '{"__proto__":{"constructor":[5,0]},"constructor":{"__proto__":[6,0]}}',
    }
    const rules = rateLimitRulesFromOptions(options)
    const updated = rateLimitOptionsFromRules(
      [
        ...rules,
        { group: 'new-group', model: null, maxRequests: 7, maxSuccess: 0 },
        { group: null, model: 'new-model', maxRequests: 8, maxSuccess: 0 },
        {
          group: 'new-group',
          model: 'new-model',
          maxRequests: 9,
          maxSuccess: 0,
        },
      ],
      options
    )
    const groups = JSON.parse(updated.ModelRequestRateLimitGroup)
    const models = JSON.parse(updated.ModelRequestRateLimitModel)
    const groupModels = JSON.parse(updated.ModelRequestRateLimitGroupModel)

    expect(Object.hasOwn(groups, '__proto__')).toBe(true)
    expect(Object.hasOwn(models, 'constructor')).toBe(true)
    expect(groups.__proto__).toEqual([1, 0])
    expect(groups.constructor).toEqual([2, 0])
    expect(models.__proto__).toEqual([3, 0])
    expect(models.constructor).toEqual([4, 0])
    expect(groupModels.__proto__.constructor).toEqual([5, 0])
    expect(groupModels.constructor.__proto__).toEqual([6, 0])
    expect(rateLimitRulesFromOptions(updated)).toEqual([
      rules[0],
      ...rules.slice(1, 3),
      { group: 'new-group', model: null, maxRequests: 7, maxSuccess: 0 },
      ...rules.slice(3, 5),
      { group: null, model: 'new-model', maxRequests: 8, maxSuccess: 0 },
      ...rules.slice(5),
      { group: 'new-group', model: 'new-model', maxRequests: 9, maxSuccess: 0 },
    ])
  })

  it('keeps equal limits in separate legacy scopes and target counters', () => {
    const options = {
      ModelRequestRateLimitCount: 5,
      ModelRequestRateLimitSuccessCount: 4,
      ModelRequestRateLimitGroup: '{"default":[5,4],"vip":[5,4]}',
      ModelRequestRateLimitModel: '{"gpt-6-luna":[5,4],"claude-3":[5,4]}',
      ModelRequestRateLimitGroupModel:
        '{"default":{"gpt-6-luna":[5,4],"claude-3":[5,4]},"vip":{"gpt-6-luna":[5,4]}}',
    }

    const rules = rateLimitRulesFromOptions(options)

    expect(rules.map(getRateLimitRuleKey)).toEqual([
      '[null,null]',
      '["default",null]',
      '["vip",null]',
      '[null,"gpt-6-luna"]',
      '[null,"claude-3"]',
      '["default","gpt-6-luna"]',
      '["default","claude-3"]',
      '["vip","gpt-6-luna"]',
    ])
    expect(rateLimitOptionsFromRules(rules, options)).toEqual(options)
  })

  it('removes a previous group-model key when the edited rule applies to all groups', () => {
    const options = {
      ...defaults,
      ModelRequestRateLimitGroup: '{"vip":[20,10]}',
      ModelRequestRateLimitModel: '{"claude-3":[8,7]}',
      ModelRequestRateLimitGroupModel:
        '{"default":{"gpt-6-luna":[4,3]},"vip":{"claude-3":[2,1]}}',
    }
    const rules = rateLimitRulesFromOptions(options).map((rule) =>
      rule.group === 'default' && rule.model === 'gpt-6-luna'
        ? { ...rule, group: null }
        : rule
    )

    const updated = rateLimitOptionsFromRules(rules, options)

    expect(updated.ModelRequestRateLimitGroup).toBe(
      options.ModelRequestRateLimitGroup
    )
    expect(JSON.parse(updated.ModelRequestRateLimitModel)).toEqual({
      'claude-3': [8, 7],
      'gpt-6-luna': [4, 3],
    })
    expect(JSON.parse(updated.ModelRequestRateLimitGroupModel)).toEqual({
      vip: { 'claude-3': [2, 1] },
    })
  })

  it('removes a previous group key when the edited rule targets specific models', () => {
    const options = {
      ...defaults,
      ModelRequestRateLimitGroup: '{"default":[4,3],"vip":[2,1]}',
    }
    const rules = rateLimitRulesFromOptions(options).flatMap((rule) =>
      rule.group === 'default' && rule.model === null
        ? [
            { ...rule, model: 'gpt-6-luna' },
            { ...rule, model: 'claude-3' },
          ]
        : [rule]
    )

    const updated = rateLimitOptionsFromRules(rules, options)

    expect(JSON.parse(updated.ModelRequestRateLimitGroup)).toEqual({
      vip: [2, 1],
    })
    expect(JSON.parse(updated.ModelRequestRateLimitGroupModel)).toEqual({
      default: { 'gpt-6-luna': [4, 3], 'claude-3': [4, 3] },
    })
  })

  it.each([
    [0, 0],
    [7, 0],
    [0, 7],
  ])(
    'preserves [%i,%i] in global, group, model and group-model scopes',
    (total, success) => {
      const counts = `[${total},${success}]`
      const options = {
        ModelRequestRateLimitCount: total,
        ModelRequestRateLimitSuccessCount: success,
        ModelRequestRateLimitGroup: `{"default":${counts}}`,
        ModelRequestRateLimitModel: `{"gpt-6-luna":${counts}}`,
        ModelRequestRateLimitGroupModel: `{"default":{"gpt-6-luna":${counts}}}`,
      }

      const rules = rateLimitRulesFromOptions(options)

      expect(rules).toHaveLength(4)
      expect(
        rules.every(
          (rule) => rule.maxRequests === total && rule.maxSuccess === success
        )
      ).toBe(true)
      expect(rateLimitOptionsFromRules(rules, options)).toEqual(options)
    }
  )

  it.each([
    ['ModelRequestRateLimitGroup', 'null'],
    ['ModelRequestRateLimitModel', '[]'],
    ['ModelRequestRateLimitGroupModel', '{'],
    ['ModelRequestRateLimitGroup', '{"default":null}'],
    ['ModelRequestRateLimitModel', '{"gpt-6-luna":[1]}'],
    ['ModelRequestRateLimitGroupModel', '{"default":{"gpt-6-luna":[1,2,3]}}'],
    ['ModelRequestRateLimitGroup', '{"default":[null,1]}'],
    ['ModelRequestRateLimitModel', '{"gpt-6-luna":[1.5,1]}'],
    ['ModelRequestRateLimitGroupModel', '{"default":{"gpt-6-luna":[1,-1]}}'],
    ['ModelRequestRateLimitGroupModel', '{"default":null}'],
    ['ModelRequestRateLimitGroupModel', '{"default":[]}'],
    ['ModelRequestRateLimitModel', '{" ": [1,1]}'],
    ['ModelRequestRateLimitGroupModel', '{"":{}}'],
    ['ModelRequestRateLimitGroupModel', '{" spaced ":{}}'],
    ['ModelRequestRateLimitGroupModel', '{"default":{"": [1,1]}}'],
    ['ModelRequestRateLimitGroup', '{"default":[9007199254740992,1]}'],
  ] as const)(
    'rejects malformed %s = %s instead of dropping saved rules',
    (key, value) => {
      const options = { ...defaults, [key]: value }

      expect(() => rateLimitRulesFromOptions(options)).toThrow()
      expect(options[key]).toBe(value)
    }
  )

  it('rejects duplicate target keys instead of overwriting a saved rule', () => {
    const rules = rateLimitRulesFromOptions(defaults)
    rules.push(
      { group: 'default', model: 'gpt-6-luna', maxRequests: 5, maxSuccess: 4 },
      { group: 'default', model: 'gpt-6-luna', maxRequests: 3, maxSuccess: 2 }
    )

    expect(() => rateLimitOptionsFromRules(rules, defaults)).toThrow(
      'Duplicate rate limit rule'
    )
  })

  it('rejects removal of the global fallback rule', () => {
    expect(() => rateLimitOptionsFromRules([], defaults)).toThrow(
      'Missing default rate limit rule'
    )
  })
})

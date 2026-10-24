import { expect, test } from 'claude-code/testing'
import type { ConfigRow } from 'claude-code'
import { settingValue } from '../hooks/settings'

const row = (over: Partial<ConfigRow>): ConfigRow =>
  ({ key: 'oh-my-toolbelt.x', label: 'X', kind: 'choice', value: 'a', options: ['a', 'b'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false, ...over }) as ConfigRow

test('a pick changes a setting only to a value its row offers', () => {
  expect(settingValue(row({ kind: 'boolean', value: true, options: undefined }), 'false')).toBe(false)
  expect(settingValue(row({ kind: 'boolean', value: true, options: undefined }), 'yes')).toBeNull()
  expect(settingValue(row({}), 'b')).toBe('b')
  expect(settingValue(row({}), 'c')).toBeNull()
  expect(settingValue(row({ kind: 'text', options: undefined }), 'anything')).toBeNull()
})

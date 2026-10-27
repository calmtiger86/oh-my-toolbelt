// The one place the mod writes /config: each of its own rows and the theme, written out, and no other key.
// The test host cannot read plugin.json, so the rows come from the status tab's labels (`settings.field.<field>`). Both
// list the same fields: a new setting needs its label and its case in `writeConfig` (hooks/register.tsx).
import { expect } from 'claude-code/testing'
import { writeConfig } from '../hooks/register'
import { test } from './helpers'
import { en } from '../hooks/locales/en'

const LABEL_PREFIX = 'settings.field.'
const OWN_KEYS = Object.keys(en)
  .filter(key => key.startsWith(LABEL_PREFIX))
  .map(key => `oh-my-toolbelt.${key.slice(LABEL_PREFIX.length)}`)

test('every row of the manifest and the theme are written under their own key, once', async ($, on) => {
  const set: string[] = []
  on('config.set', (_, e) => (set.push(e.key), { value: e.value }))
  for (const key of [...OWN_KEYS, 'theme']) expect(await writeConfig($ as never, key, 'x')).toEqual({ value: 'x' })
  expect(set).toEqual([...OWN_KEYS, 'theme'])
})

test('a key that is not one of those is refused before /config sees it', async ($, on) => {
  const set: string[] = []
  on('config.set', (_, e) => (set.push(e.key), { value: e.value }))
  for (const key of ['permissions.defaultMode', 'oh-my-toolbelt.nope', 'verbose']) {
    await expect(writeConfig($ as never, key, 'x')).rejects.toThrow(`not a setting this mod writes: ${key}`)
  }
  expect(set).toEqual([])
})

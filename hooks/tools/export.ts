// Export tool. Pure: register.tsx reads the conversation and writes the files (hooks/lib/export.ts).
import { faceOf } from '../lib/icons'
import type { IconStyle } from '../lib/icons'
import type { TFn } from '../lib/i18n'

const ICON = '⇩'

// `⇩ Export`, the icon alone when the band is tight, by the icon style. `picked` is the icon the person chose (`''` for none).
export const exportLabel = (size: 'long' | 'short', style: IconStyle, picked: string | undefined, t: TFn): string =>
  faceOf(style, size, picked ?? ICON, t('tool.export'))

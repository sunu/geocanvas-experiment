import { RectangleIcon } from '@phosphor-icons/react'
import { PALETTE, type ColorName } from '../canvas/style'
import type { ObjectTypeDef, ObjectViewProps } from './types'

const DEFAULT_COLOR: ColorName = 'blue'

declare module '../board/board' {
  interface ObjectFields {
    /** color is optional: boxes made before it existed use the default. */
    box: { color?: ColorName }
  }
}

export const box: ObjectTypeDef<'box'> = {
  type: 'box',
  label: 'Box',
  key: 'r',
  Icon: RectangleIcon,
  size: { w: 200, h: 120 },
  layer: 'bottom',
  create: (r) => ({ type: 'box', ...r }),
  View: BoxView,
  defaultColor: DEFAULT_COLOR,
}

function BoxView({ object: o }: ObjectViewProps<'box'>) {
  const color = PALETTE[o.color ?? DEFAULT_COLOR]
  return <div className="ttx-box" style={{ background: color.fill, borderColor: color.stroke }} />
}

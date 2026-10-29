import { registerWidget } from '../canvas/registry'
import { AreaPicker } from './AreaPicker'

/** An area of interest in a form, e.g. for 'template.conflict' in the palette. */
registerWidget('area', ({ value, onChange }) => (
  <div className="ttx-field__area">
    <AreaPicker value={value} onChange={onChange} />
  </div>
))

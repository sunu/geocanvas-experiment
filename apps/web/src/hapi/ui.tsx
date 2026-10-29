import { registerObjectUI, registerWidget } from '../canvas/registry'
import { ConflictObject } from './ConflictObject'
import { CountryObject } from './CountryObject'
import { CountryPicker } from './CountryWidget'
import { PresenceObject } from './PresenceObject'

// No key tools: they are in the toolbar's Event context menu (canvas/Toolbar.tsx), and in the palette (country.add, presence.add, conflict.add) and for the agent.
registerObjectUI('country', { View: CountryObject, editable: true, editOnCreate: true })
registerObjectUI('presence', { View: PresenceObject, editable: true, editOnCreate: true })
registerObjectUI('conflict', { View: ConflictObject, editable: true, editOnCreate: true })

/** Pick a country in a form, e.g. for 'country.add' in the palette: the same list as the widgets. */
registerWidget('country', ({ value, onChange }) => (
  <div className="ttx-field__country">
    <CountryPicker selected={typeof value === 'string' ? value : undefined} onPick={onChange} />
  </div>
))

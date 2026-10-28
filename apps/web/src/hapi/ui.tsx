import { registerObjectUI, registerWidget } from '../canvas/registry'
import { CountryObject, CountryPicker } from './CountryObject'

// No toolbar tool: a country context is added from the palette (country.add), or by the agent.
registerObjectUI('country', { View: CountryObject, editable: true, editOnCreate: true })

/** Pick a country in a form, e.g. for 'country.add' in the palette: the same list as the country context. */
registerWidget('country', ({ value, onChange }) => (
  <div className="ttx-field__country">
    <CountryPicker selected={typeof value === 'string' ? value : undefined} onPick={onChange} />
  </div>
))

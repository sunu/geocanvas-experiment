import type { AnyObject } from '@ttx/core'
import { choroplethLayer } from '../hapi.js'
import type { MapBoardObject } from '../map.js'
import { eventLayer, type MapLayer } from '../mapLayers.js'
import type { Area } from '../mapView.js'
import type { Facts } from '../templates/seeds.js'

/**
 * Link recipes (plans/plan-013.md): what a linked node shows of its root. A recipe renders only its own part of
 * the node, so other changes people made stay (a layer they added to a linked map). When the facts it needs are
 * missing, it blanks its part: a node never keeps showing an old root's data.
 */

/** What a recipe writes on a node. */
export interface Rendered {
  set: Record<string, unknown>
  /** Optional fields to remove (BoardTx.clear). */
  clear?: string[]
  /** For a map: the area to show to the person who changed the root. */
  view?: Area
}

export interface Recipe {
  id: string
  /** The object types it can render. */
  types: string[]
  render(facts: Facts, node: AnyObject, args: Record<string, unknown>): Rendered
}

/** The id of the one layer a recipe owns on a map, so it replaces that layer and no other. */
export const linkedLayerId = (recipe: string) => `link:${recipe}`

/** The map's layers with the recipe's layer replaced (in place), added (first) or removed (undefined). */
function withLayer(node: AnyObject, recipe: string, layer: MapLayer | undefined): MapLayer[] {
  const id = linkedLayerId(recipe)
  const layers = (node as MapBoardObject).layers ?? []
  const owned = layer && { ...layer, id }
  if (!owned) return layers.filter((l) => l.id !== id)
  return layers.some((l) => l.id === id) ? layers.map((l) => (l.id === id ? owned : l)) : [owned, ...layers]
}

const mapRecipe = (id: string, layer: (f: Facts) => MapLayer | undefined): Recipe => ({
  id,
  types: ['map'],
  render: (facts, node) => ({ set: { layers: withLayer(node, id, layer(facts)) }, ...(facts.area && { view: facts.area }) }),
})

const list: Recipe[] = [
  {
    id: 'country',
    types: ['country', 'presence', 'conflict'],
    render: (f) => (f.country ? { set: { country: f.country } } : { set: {}, clear: ['country'] }),
  },
  {
    id: 'reliefweb',
    types: ['reliefweb'],
    render: (f) =>
      f.glides?.length
        ? { set: { glides: f.glides, ...(f.name && { title: f.name }) }, ...(!f.name && { clear: ['title'] }) }
        : { set: { glides: [] }, clear: ['title'] },
  },
  mapRecipe('eventFootprint', (f) => (f.eventId ? eventLayer(f.eventId, f.name) : undefined)),
  mapRecipe('conflictChoropleth', (f) => (f.country ? choroplethLayer(f.country, 'conflictEvents', 1) : undefined)),
  {
    id: 'frameTitle',
    types: ['frame'],
    render: (f, _node, args) => (f.name ? { set: { title: `${typeof args.prefix === 'string' ? args.prefix : ''}${f.name}` } } : { set: {}, clear: ['title'] }),
  },
]

export const RECIPES: Record<string, Recipe> = Object.fromEntries(list.map((r) => [r.id, r]))

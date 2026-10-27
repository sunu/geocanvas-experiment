/**
 * Monty sources that have event data (checked on the live API; Charter and AlertHub have none yet), what to call
 * them, how people type them, and the collections that hold their events. The words are matched in text that is
 * already folded, where "EM-DAT" is "em dat". Collections are named `<source>-<events|impacts|hazards>`.
 * https://github.com/IFRCGo/monty-stac-extension/blob/main/docs/model/sources/sources.yml
 */
const SOURCES: Record<string, { label: string; words: RegExp; events: string[] }> = {
  gdacs: { label: 'GDACS', words: /\bgdacs\b/g, events: ['gdacs-events'] },
  emdat: { label: 'EM-DAT', words: /\bem ?dat\b/g, events: ['emdat-events'] },
  pdc: { label: 'PDC', words: /\bpdc\b/g, events: ['pdc-events'] },
  ifrcevent: { label: 'IFRC', words: /\bifrc( ?event)?\b/g, events: ['ifrcevent-events'] },
  usgs: { label: 'USGS', words: /\busgs\b/g, events: ['usgs-events'] },
  glide: { label: 'GLIDE', words: /\bglide\b/g, events: ['glide-events'] },
  cems: { label: 'CEMS', words: /\bcems\b/g, events: ['cems-events'] },
  ibtracs: { label: 'IBTrACS', words: /\bibtracs\b/g, events: ['ibtracs-events'] },
  gfd: { label: 'GFD', words: /\bgfd\b/g, events: ['gfd-events'] },
  idmc: { label: 'IDMC', words: /\bidmc\b/g, events: ['idmc-gidd-events', 'idmc-idu-events'] },
  desinventar: { label: 'DesInventar', words: /\bdesinventar\b/g, events: ['desinventar-events'] },
}

/** The name to show for a Monty source: "emdat" -> "EM-DAT", "pdc" -> "PDC". */
export const sourceLabel = (source: string): string => SOURCES[source]?.label ?? source.toUpperCase()

/** The event collections of a source named in a search. */
export const eventCollections = (source: string): string[] => SOURCES[source]?.events ?? []

/** The event collections of every source. */
export const ALL_EVENT_COLLECTIONS = Object.values(SOURCES).flatMap((s) => s.events)

/** The sources a folded text names, and the text without them. */
export function extractSources(folded: string): { sources: string[]; rest: string } {
  const sources: string[] = []
  let rest = folded
  for (const [source, { words }] of Object.entries(SOURCES)) {
    const next = rest.replace(words, ' ')
    if (next !== rest) sources.push(source)
    rest = next
  }
  return { sources, rest }
}

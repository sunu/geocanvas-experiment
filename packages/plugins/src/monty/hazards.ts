import type { DisasterType } from './types'

/**
 * Hazard codes for each type this plugin shows. Source of truth is upstream, not us:
 * https://github.com/IFRCGo/monty-stac-extension/blob/main/docs/model/taxonomy.md#cross-classification-mapping
 *
 * An item's `monty:hazard_codes` can hold codes from three systems: UNDRR-ISC 2025 (primary), GLIDE, and
 * EM-DAT. A filter lists all three so it matches whichever the source filled in.
 * Add a type here only with its rows from the upstream table.
 */
const HAZARD_CODES: Record<DisasterType, string[]> = {
  cyclone: ['MH0309', 'MH0308', 'TC', 'nat-met-sto-tro'],
  flood: [
    // MH0600 is the flooding chapeau, MH0601-MH0610 the specific flood types.
    ...Array.from({ length: 11 }, (_, i) => `MH06${String(i).padStart(2, '0')}`),
    'FL',
    'FF',
    'nat-hyd-flo-flo',
    'nat-hyd-flo-riv',
    'nat-hyd-flo-coa',
    'nat-hyd-flo-fla',
    'nat-hyd-flo-ice',
    'nat-cli-glo-glo',
  ],
  earthquake: ['GH0101', 'EQ', 'nat-geo-ear-gro'],
  drought: ['MH0401', 'DR', 'nat-cli-dro-dro'],
}

export const DISASTER_TYPES = Object.keys(HAZARD_CODES) as DisasterType[]
const TYPE_OF_CODE = new Map(DISASTER_TYPES.flatMap((type) => HAZARD_CODES[type].map((code) => [code, type] as const)))

/** Words people use for each type. Everyday terms the taxonomy does not spell out ("hurricane") come from upstream's synonym list. */
const WORDS: Record<DisasterType, RegExp> = {
  cyclone: /\b(cyclone|hurricane|typhoon|tropical storm)s?\b/i,
  flood: /\bflood(s|ing|ed)?\b/i,
  earthquake: /\b(earthquake|quake)s?\b/i,
  drought: /\bdroughts?\b/i,
}

export const hazardCodes = (type: DisasterType): string[] => HAZARD_CODES[type]

/** The type of an item from its `monty:hazard_codes`: the first code that belongs to a type this plugin shows. */
export function disasterTypeOf(codes: string[]): DisasterType | undefined {
  for (const code of codes) {
    const type = TYPE_OF_CODE.get(code)
    if (type) return type
  }
}

/** The types a piece of text names, e.g. "hurricane" or "floods", and the text without those words. */
export function extractHazardTypes(text: string): { types: DisasterType[]; rest: string } {
  const types: DisasterType[] = []
  let rest = text
  for (const type of DISASTER_TYPES) {
    const next = rest.replace(new RegExp(WORDS[type].source, 'gi'), ' ')
    if (next !== rest) types.push(type)
    rest = next
  }
  return { types, rest }
}

export const hazardTypesIn = (text: string): DisasterType[] => extractHazardTypes(text).types

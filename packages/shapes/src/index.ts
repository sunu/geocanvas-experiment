import { createTLSchema, defaultBindingSchemas, defaultShapeSchemas } from '@tldraw/tlschema'
import { MAP_SHAPE, mapShapeMigrations, mapShapeProps } from './map.ts'

export * from './map.ts'

/** The board schema. The sync server validates every change against it, so it must match the client's shape utils. */
export const schema = createTLSchema({
  shapes: { ...defaultShapeSchemas, [MAP_SHAPE]: { props: mapShapeProps, migrations: mapShapeMigrations } },
  bindings: defaultBindingSchemas,
})

import { PluginCatalog } from '@geo-canvas/core'
import { corePlugin } from '@geo-canvas/plugin-core'
import { createDisastersPlugin, MockDisasterProvider } from '@geo-canvas/plugin-disasters'

/** All plugins that this app build knows about. Each canvas enables a subset. */
export const catalog = new PluginCatalog([corePlugin, createDisastersPlugin(new MockDisasterProvider(150))])

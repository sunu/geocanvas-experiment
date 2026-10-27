import { PluginCatalog } from '@geo-canvas/core'
import { corePlugin } from '@geo-canvas/plugin-core'
import { createDisastersPlugin, MockDisasterProvider, MontyDisasterProvider } from '@geo-canvas/plugin-disasters'

/** Real Monty data by default. Set VITE_DISASTER_DATA=mock for the synthetic data (offline, or no gateway). */
function disasterData() {
  return import.meta.env.VITE_DISASTER_DATA === 'mock' ? new MockDisasterProvider(150) : new MontyDisasterProvider()
}

/** All plugins that this app build knows about. Each canvas enables a subset. */
export const catalog = new PluginCatalog([corePlugin, createDisastersPlugin(disasterData())])

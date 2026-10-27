import { useSync } from '@tldraw/sync'
import {
  DefaultToolbar,
  DefaultToolbarContent,
  defaultShapeUtils,
  FileHelpers,
  Tldraw,
  TldrawUiMenuItem,
  useIsToolSelected,
  useTools,
  type TLAssetStore,
  type TLComponents,
  type TLUiAssetUrlOverrides,
  type TLUiOverrides,
} from 'tldraw'
import { MAP_SHAPE } from '@ttx/shapes'
import { MapShapeTool, MapShapeUtil } from './map/MapShapeUtil'

const customShapeUtils = [MapShapeUtil]
const allShapeUtils = [...defaultShapeUtils, ...customShapeUtils]
const tools = [MapShapeTool]

/** The board to join: #room=<name>, default "demo". */
const room = /room=([\w-]{1,64})/.exec(location.hash)?.[1] ?? 'demo'
const syncUri = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/connect/${room}`
// Editing the hash to change room does not reload the page by itself.
addEventListener('hashchange', () => location.reload())

/** Images go into the board as data URLs. Fine for now; large files need an upload endpoint. */
const assets: TLAssetStore = {
  async upload(_asset, file) {
    return { src: await FileHelpers.blobToDataUrl(file) }
  },
  resolve: (asset) => asset.props.src,
}

const GLOBE_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  )
const assetUrls: TLUiAssetUrlOverrides = { icons: { 'tool-map': GLOBE_ICON } }

const overrides: TLUiOverrides = {
  tools(editor, tools) {
    tools[MAP_SHAPE] = {
      id: MAP_SHAPE,
      icon: 'tool-map',
      label: 'Map',
      onSelect: () => editor.setCurrentTool(MAP_SHAPE),
    }
    return tools
  },
}

const components: TLComponents = {
  Toolbar: (props) => {
    const tools = useTools()
    const isMapSelected = useIsToolSelected(tools[MAP_SHAPE])
    return (
      <DefaultToolbar {...props}>
        <TldrawUiMenuItem {...tools[MAP_SHAPE]!} isSelected={isMapSelected} />
        <DefaultToolbarContent />
      </DefaultToolbar>
    )
  },
}

export function App() {
  const store = useSync({ uri: syncUri, assets, shapeUtils: allShapeUtils })
  return (
    <Tldraw
      store={store}
      shapeUtils={customShapeUtils}
      tools={tools}
      overrides={overrides}
      components={components}
      assetUrls={assetUrls}
      licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
      onMount={(editor) => {
        if (import.meta.env.DEV) Object.assign(window, { editor })
      }}
    />
  )
}

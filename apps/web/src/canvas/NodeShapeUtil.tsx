import { BaseBoxShapeUtil, HTMLContainer, T, Vec, useEditor, useValue, type TLShape } from 'tldraw'
import { MAP_HEADER_H } from '@geo-canvas/plugin-core'
import { NodeFrame } from './NodeFrame'

export const NODE_SHAPE = 'gc-node'

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [NODE_SHAPE]: { w: number; h: number; nodeType: string }
  }
}

export type NodeShape = TLShape<typeof NODE_SHAPE>

/** Shape id of a doc node. Shape ids must start with 'shape:'. */
export const shapeIdOf = (nodeId: string) => `shape:${nodeId}` as NodeShape['id']
export const nodeIdOf = (shapeId: string) => shapeId.replace(/^shape:/, '')

/**
 * One generic shape for all node types. It holds only the layout.
 * The node content comes from the runtime and the UI registry.
 */
export class NodeShapeUtil extends BaseBoxShapeUtil<NodeShape> {
  static override type = NODE_SHAPE
  static override props = { w: T.number, h: T.number, nodeType: T.string }

  getDefaultProps(): NodeShape['props'] {
    return { w: 200, h: 120, nodeType: 'core.sticky' }
  }

  override canEdit() {
    return true
  }

  override canBind() {
    return false
  }

  /** Maps clip their pinned children to the map view (below the header). */
  override getClipPath(shape: NodeShape): Vec[] | undefined {
    if (shape.props.nodeType !== 'core.map') return undefined
    const { w, h } = shape.props
    return [new Vec(0, MAP_HEADER_H), new Vec(w, MAP_HEADER_H), new Vec(w, h), new Vec(0, h)]
  }

  /** A selected child is not clipped, so the user can see it while dragging it off the map. */
  override shouldClipChild(child: TLShape): boolean {
    return !this.editor.getSelectedShapeIds().includes(child.id)
  }

  component(shape: NodeShape) {
    return <NodeShapeComponent shape={shape} />
  }

  getIndicatorPath(shape: NodeShape) {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, 10)
    return path
  }
}

function NodeShapeComponent({ shape }: { shape: NodeShape }) {
  const editor = useEditor()
  const editing = useValue('editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
  // A card on a map takes pointer events, so a map in edit mode under it does not swallow them.
  const onMap = useValue('on map', () => {
    const parent = shape.parentId.startsWith('shape:') ? editor.getShape(shape.parentId) : undefined
    return (parent?.props as { nodeType?: string } | undefined)?.nodeType === 'core.map'
  }, [editor, shape.parentId])
  return (
    <HTMLContainer style={{ width: shape.props.w, height: shape.props.h, pointerEvents: editing || onMap ? 'all' : 'none' }}>
      <NodeFrame nodeId={nodeIdOf(shape.id)} width={shape.props.w} height={shape.props.h} editing={editing} />
    </HTMLContainer>
  )
}

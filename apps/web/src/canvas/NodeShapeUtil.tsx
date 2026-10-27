import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, useValue, type TLShape } from 'tldraw'
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
  return (
    <HTMLContainer style={{ width: shape.props.w, height: shape.props.h, pointerEvents: editing ? 'all' : 'none' }}>
      <NodeFrame nodeId={nodeIdOf(shape.id)} width={shape.props.w} height={shape.props.h} editing={editing} />
    </HTMLContainer>
  )
}

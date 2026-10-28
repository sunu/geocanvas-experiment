import * as Y from 'yjs'
import { Runtime } from './runtime.js'

/** Transaction origin of updates copied from the main doc into a draft. */
const FROM_MAIN = Symbol('fromMain')

/**
 * A private copy of the board, for edits that others see only when they are shared (in-focus mode,
 * agent-docs/tasks/in-focus-widgets.md). It has its own runtime, with the same plugins and actor, so
 * every op and undo work as on the board.
 *
 * Changes to the main doc (other people, the agent, this person's other tabs) keep arriving in the
 * draft. Nothing goes the other way until share(): it sends the draft's own changes to the main doc
 * as one undo step there. Concurrent edits merge by Yjs's rules, as any two people's edits do.
 */
export class Draft {
  readonly runtime: Runtime
  private readonly main: Runtime
  private unshared = false

  constructor(main: Runtime) {
    this.main = main
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(main.board.doc), FROM_MAIN)
    this.runtime = new Runtime({ doc, plugins: main.registry.plugins, actor: main.actor })
    main.board.doc.on('update', this.fromMain)
    // A state vector misses deletions (they add no clock), so track own changes per transaction.
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin !== FROM_MAIN && (tr.changed.size > 0 || tr.deleteSet.clients.size > 0)) this.unshared = true
    })
  }

  /** The draft has changes that the main doc does not have yet. */
  hasUnshared(): boolean {
    return this.unshared
  }

  /** Send the draft's changes to the main doc, as one undo step there. Returns false if there were none. */
  share(): boolean {
    this.runtime.flush()
    if (!this.unshared) return false
    // Only what the main doc lacks. Main's own changes are already in it, and so are earlier shares.
    const update = Y.encodeStateAsUpdate(this.runtime.board.doc, Y.encodeStateVector(this.main.board.doc))
    this.main.applyDraft(update)
    this.unshared = false
    return true
  }

  /** Stop following the main doc and drop the draft. Unshared changes are lost: share() first to keep them. */
  close() {
    this.main.board.doc.off('update', this.fromMain)
    this.runtime.destroy()
    this.runtime.board.doc.destroy()
  }

  private fromMain = (update: Uint8Array) => {
    Y.applyUpdate(this.runtime.board.doc, update, FROM_MAIN)
  }
}

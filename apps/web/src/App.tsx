import { useEffect, useMemo, useState } from 'react'
import { Tldraw, type Editor, type TLComponents } from 'tldraw'
import { createSession, roomFromUrl, type Session } from './session'
import { SessionContext } from './ui/context'
import { NodeShapeUtil } from './canvas/NodeShapeUtil'
import { bindEditor, viewController } from './canvas/bridge'
import { setEditor, selectionTarget } from './canvas/editorRef'
import { InFront, OnCanvas } from './canvas/Overlays'
import { linking } from './canvas/ports'
import { Palette } from './palette/Palette'
import { palette } from './palette/store'
import { SidePanel, TopBar, EmptyState } from './ui/Chrome'
import { AddBar, DoubleClickToAdd } from './ui/AddBar'
import { sidebar } from './ui/sidebar'
import './nodes/core'
import './nodes/disasters'

const shapeUtils = [NodeShapeUtil]
function InFrontAll() {
  return (
    <>
      <InFront />
      <DoubleClickToAdd />
    </>
  )
}

const components: TLComponents = { OnTheCanvas: OnCanvas, InFrontOfTheCanvas: InFrontAll }

export function App() {
  const [room] = useState(roomFromUrl)
  const session = useMemo(() => createSession(room), [room])
  useEffect(() => () => {
    session.provider.destroy()
    session.runtime.destroy()
  }, [session])
  useGlobalKeys(session)

  return (
    <SessionContext.Provider value={session}>
      <div className="gc-app">
        <TopBar />
        <div className="gc-main">
          <div className="gc-canvas">
            <Tldraw
              hideUi
              shapeUtils={shapeUtils}
              components={components}
              onMount={(editor: Editor) => {
                setEditor(editor)
                if (import.meta.env.DEV) Object.assign(window, { editor, runtime: session.runtime })
                session.runtime.view = viewController(editor)
                editor.user.updateUserPreferences({ colorScheme: 'system' })
                const unbind = bindEditor(editor, session.runtime)
                return () => {
                  unbind()
                  setEditor(null)
                }
              }}
            />
            <EmptyState />
            <AddBar />
          </div>
          <SidePanel />
        </div>
        <Palette />
      </div>
    </SessionContext.Provider>
  )
}

/** App keys. tldraw's own shortcuts are off (hideUi), so every change goes through an op. */
function useGlobalKeys(session: Session) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.closest('input, textarea, select, [contenteditable="true"]')
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (palette.get().open) palette.close()
        else palette.open()
        return
      }
      if (mod && e.key === '\\') {
        e.preventDefault()
        sidebar.toggle()
        return
      }
      if (typing || palette.get().open) return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) session.runtime.redo()
        else session.runtime.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        session.runtime.redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const t = selectionTarget()
        if (t.kind === 'nodes') void session.runtime.dispatch('core.node.delete', t, {})
      } else if (e.key === 'Escape') {
        linking.set(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])
}

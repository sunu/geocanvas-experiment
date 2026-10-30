import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'

/**
 * A Python editor (CodeMirror 6), loaded only when someone edits code (code/CodeEditor.tsx imports it lazily).
 * The board's text is the truth: a change from elsewhere (another person, an agent's run) replaces the editor's
 * text unless it is the one this editor just sent.
 */
export default function Editor({ value, onChange, onRun, onEscape, autoFocus }: { value: string; onChange(v: string): void; onRun?(): void; onEscape?(): void; autoFocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  // The latest handlers, so the editor made once calls the current ones.
  const handlers = useRef({ onChange, onRun, onEscape })
  handlers.current = { onChange, onRun, onEscape }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle),
          python(),
          keymap.of([
            { key: 'Mod-Enter', run: () => (handlers.current.onRun?.(), true) },
            { key: 'Shift-Enter', run: () => (handlers.current.onRun?.(), true) },
            { key: 'Escape', run: () => (handlers.current.onEscape?.(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => u.docChanged && handlers.current.onChange(u.state.doc.toString())),
        ],
      }),
    })
    view.current = v
    if (autoFocus) v.focus()
    return () => v.destroy()
  }, [])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div className="ttx-code__editor" ref={host} />
}

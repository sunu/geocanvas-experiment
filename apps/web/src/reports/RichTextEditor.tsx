import { useEffect, useMemo } from 'react'
import { EditorContent, Extension, getSchema, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { docText, textDoc, type RichDoc } from '@ttx/plugins'
import { clampHeadings, shouldFormatPaste } from './markdownPaste'
import { richTextExtensions, richTextKit } from './richTextExtensions'

/** Paste markdown as formatted text (markdownPaste.ts decides what is markdown). ⌘/Ctrl+Shift+V pastes the text as it is. */
const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const { editor } = this
    let plainAt = 0
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'v') plainAt = Date.now()
            return false
          },
          handlePaste: (_view, e) => {
            const data = e.clipboardData
            const text = data?.getData('text/plain') ?? ''
            if (!data || Date.now() - plainAt < 1000 || !shouldFormatPaste(data.types, text)) return false
            editor.commands.insertContent(clampHeadings(text), { contentType: 'markdown' })
            return true
          },
        },
      }),
    ]
  },
})

const extensions = [...richTextExtensions, MarkdownPaste]
const schema = getSchema([richTextKit])

/** The block's document, or its text when it holds something the editor has no node for (the editor would drop it all). */
function editable(doc: RichDoc): RichDoc {
  try {
    schema.nodeFromJSON(doc).check()
    return doc
  } catch {
    return textDoc(docText(doc))
  }
}

/**
 * Where the caret is, for a text that goes on over pages (editing.tsx): `y`, the middle of its line, in the text's own
 * px from its top, as pagination measures it (the editor draws the same elements as RichText.tsx, in the same type);
 * and `pos`, its place in the document.
 */
export interface Caret {
  y: number
  pos: number
}

function caretOf(editor: Editor): Caret {
  const el = editor.view.dom as HTMLElement
  const box = el.getBoundingClientRect()
  const k = box.height / (el.offsetHeight || 1) // the page's zoom
  const pos = editor.state.selection.head
  const c = editor.view.coordsAtPos(pos)
  return { y: ((c.top + c.bottom) / 2 - box.top) / k, pos }
}

/**
 * The rich text editor of a report's text block (Tiptap). It keeps its own content while editing and reports each
 * change as the editor's JSON; the report is written by the caller. Loaded on its own (`React.lazy`), since it is most
 * of the weight and only report mode needs it. The caret starts at `start`: the position given, else under the point
 * where the text was pressed, else at the end.
 */
export default function RichTextEditor({
  doc,
  start,
  onChange,
  onCaret,
  onBlur,
}: {
  doc: RichDoc
  start?: { pos?: number; point?: { x: number; y: number } }
  onChange: (doc: RichDoc) => void
  onCaret?: (caret: Caret) => void
  onBlur: () => void
}) {
  const content = useMemo(() => editable(doc), []) // eslint-disable-line react-hooks/exhaustive-deps -- the editor owns the content from here on
  const editor = useEditor({
    extensions,
    content: content as JSONContent,
    editorProps: { attributes: { class: 'ttx-report__text ttx-report__editor', 'aria-label': 'Text' } },
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON() as RichDoc)
      onCaret?.(caretOf(editor))
    },
    onSelectionUpdate: ({ editor }) => onCaret?.(caretOf(editor)),
    onBlur,
  })
  // Focus is taken as the editor mounts, and again on the next frame if something took it meanwhile (see useFocusSoon):
  // the caret where the text was pressed, as the editor draws the text where its picture was.
  useEffect(() => {
    if (!editor) return
    const place = () => {
      if (editor.isDestroyed || editor.isFocused) return
      const pressed = start?.point && editor.view.posAtCoords({ left: start.point.x, top: start.point.y })?.pos
      editor.commands.focus(start?.pos ?? pressed ?? 'end')
    }
    place()
    const frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
    // Once, as typing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])
  return <EditorContent editor={editor} />
}

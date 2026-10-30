import { useEffect, useMemo } from 'react'
import { EditorContent, Extension, getSchema, useEditor, type JSONContent } from '@tiptap/react'
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
 * The rich text editor of a report's text block (Tiptap). It keeps its own content while editing and reports each
 * change as the editor's JSON; the report is written by the caller. Loaded on its own (`React.lazy`), since it is most
 * of the weight and only report mode needs it.
 */
export default function RichTextEditor({ doc, onChange, onBlur }: { doc: RichDoc; onChange: (doc: RichDoc) => void; onBlur: () => void }) {
  const content = useMemo(() => editable(doc), []) // eslint-disable-line react-hooks/exhaustive-deps -- the editor owns the content from here on
  const editor = useEditor({
    extensions,
    content: content as JSONContent,
    autofocus: 'end',
    editorProps: { attributes: { class: 'ttx-report__text ttx-report__editor', 'aria-label': 'Text' } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichDoc),
    onBlur,
  })
  // Focus is taken as the editor mounts (autofocus); again on the next frame if something took it meanwhile (see useFocusSoon).
  useEffect(() => {
    if (!editor) return
    const frame = requestAnimationFrame(() => !editor.isDestroyed && !editor.isFocused && editor.commands.focus('end'))
    return () => cancelAnimationFrame(frame)
  }, [editor])
  return <EditorContent editor={editor} />
}

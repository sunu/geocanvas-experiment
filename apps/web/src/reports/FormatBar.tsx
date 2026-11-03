import { useEffect, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import {
  CheckIcon,
  CodeIcon,
  LinkIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  QuotesIcon,
  TextAaIcon,
  TextBIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  type Icon,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { BTN, Face } from '../canvas/Toolbar'
import { FORMAT_ATTR } from './editing'
import { linkHref } from './RichText'

const STYLES = [
  { label: 'Text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const

const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform)
const key = (k: string) => (mac ? `⌘${k}` : `Ctrl+${k}`)

/**
 * The formatting tools of a report's text (agent-docs/tasks/reports.md §5.3), in the report toolbar while someone types
 * in a text (RichTextEditor portals it there). Buttons never take the focus from the editor; the style menu and the link
 * popover do, and give it back when they close.
 */
export function FormatBar({ editor, onDone }: { editor: Editor; onDone(): void }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      level: ([1, 2, 3] as const).find((level) => e.isActive('heading', { level })) ?? 0,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      link: e.isActive('link'),
    }),
  })
  const chain = () => editor.chain().focus()
  const menu = useMenuFocus(editor, onDone)
  const separator = <Separator orientation="vertical" className="data-[orientation=vertical]:h-8" />
  const style = STYLES.find((s) => s.level === on.level) ?? STYLES[0]

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className={`${BTN} min-w-16`} title="Text style" aria-label={`Text style: ${style.label}`}>
            <Face Icon={TextAaIcon} text={style.label} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menu} side="top" align="start">
          {STYLES.map((s) => (
            <DropdownMenuItem
              key={s.level}
              onSelect={() => (s.level ? chain().setHeading({ level: s.level }).run() : chain().setParagraph().run())}
              aria-checked={s.level === on.level}
              className={s.level === on.level ? 'font-medium' : undefined}
            >
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {separator}
      <Tool Icon={TextBIcon} text="Bold" title={`Bold (${key('B')})`} on={on.bold} run={() => chain().toggleBold().run()} />
      <Tool Icon={TextItalicIcon} text="Italic" title={`Italic (${key('I')})`} on={on.italic} run={() => chain().toggleItalic().run()} />
      <Tool Icon={TextStrikethroughIcon} text="Strike" title={`Strikethrough (${key('Shift+S')})`} on={on.strike} run={() => chain().toggleStrike().run()} />
      <Tool Icon={CodeIcon} text="Code" title={`Code (${key('E')})`} on={on.code} run={() => chain().toggleCode().run()} />
      {separator}
      <Tool Icon={ListBulletsIcon} text="Bullets" title="Bulleted list (type - and a space)" on={on.bulletList} run={() => chain().toggleBulletList().run()} />
      <Tool Icon={ListNumbersIcon} text="Numbers" title="Numbered list (type 1. and a space)" on={on.orderedList} run={() => chain().toggleOrderedList().run()} />
      <Tool Icon={QuotesIcon} text="Quote" title="Quote (type > and a space)" on={on.blockquote} run={() => chain().toggleBlockquote().run()} />
      {separator}
      <LinkTool editor={editor} on={on.link} menu={menu} />
      {separator}
      <Tool Icon={CheckIcon} text="Done" title="Stop editing (Esc)" run={onDone} />
    </>
  )
}

/**
 * The style menu and the link popover take the focus from the editor, so its blur does not count (RichTextEditor), and
 * they follow the same rule themselves: typing ends when the focus goes anywhere but the text or the bar. As one closes,
 * the focus goes back to the editor, with its selection, unless something outside closed it (a press, or focus that
 * moved there). Some presses never reach the menu (the Options panel stops them): the focus then leaves the menu for
 * nothing, which ends typing too, once it has settled.
 */
function useMenuFocus(editor: Editor, onDone: () => void) {
  const away = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => void (mounted.current = false)
  }, [])
  const ours = (el: Element | null) => !!el && (editor.view.dom.contains(el) || !!el.closest(`[${FORMAT_ATTR}]`))
  return {
    [FORMAT_ATTR]: '',
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault()
      if (!away.current) editor.commands.focus()
      away.current = false
    },
    onInteractOutside: (e: CustomEvent<{ originalEvent: Event }>) => {
      if (ours(e.detail.originalEvent.target as Element | null)) return
      away.current = true
      onDone()
    },
    onBlur: () =>
      requestAnimationFrame(() => {
        if (mounted.current && !ours(document.activeElement)) onDone()
      }),
  }
}
type MenuFocus = ReturnType<typeof useMenuFocus>

/** A button that runs at once and keeps the editor's focus (no focus on press). */
function Tool({ Icon, text, title, on, run }: { Icon: Icon; text: string; title: string; on?: boolean; run(): void }) {
  return (
    <Button
      variant={on ? 'secondary' : 'ghost'}
      size="sm"
      className={BTN}
      title={title}
      aria-label={text}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Face Icon={Icon} text={text} />
    </Button>
  )
}

/**
 * Link: the selected words, or the link the caret is in, go to the address typed; with nothing selected, the address
 * is added as its own text. Remove takes the link off and keeps the words.
 */
function LinkTool({ editor, on, menu }: { editor: Editor; on: boolean; menu: MenuFocus }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string>()
  const apply = () => {
    const href = linkHref(typed)
    if (!href) return setError('Links go to web (https://…) or mail (mailto:…) addresses')
    const { empty } = editor.state.selection
    if (on) editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    else if (empty) editor.chain().focus().insertContent({ type: 'text', text: typed.trim(), marks: [{ type: 'link', attrs: { href } }] }).run()
    else editor.chain().focus().setLink({ href }).run()
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setTyped(on ? String(editor.getAttributes('link').href ?? '') : '')
          setError(undefined)
        }
        setOpen(o)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant={on ? 'secondary' : 'ghost'} size="sm" className={BTN} title="Link" aria-label="Link" aria-pressed={on} onMouseDown={(e) => e.preventDefault()}>
          <Face Icon={LinkIcon} text="Link" />
        </Button>
      </PopoverTrigger>
      <PopoverContent {...menu} side="top" className="w-80 p-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <Input autoFocus aria-label="Link address" placeholder="https://…" value={typed} onChange={(e) => (setTyped(e.target.value), setError(undefined))} />
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {on && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run()
                  setOpen(false)
                }}
              >
                Remove link
              </Button>
            )}
            <Button type="submit" size="sm">
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

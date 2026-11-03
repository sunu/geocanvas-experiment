import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'

/**
 * What a report's text can hold (reports.md §5.3): paragraphs, headings of the report's three levels, bold, italic,
 * strike, links, lists, quotes and code. A change to this list is a change to what `RichText.tsx` must draw, and to
 * what older reports may contain: never remove one.
 */
export const richTextKit = StarterKit.configure({
  heading: { levels: [1, 2, 3] },
  underline: false, // markdown has none
  link: { openOnClick: false, autolink: false },
})

export const richTextExtensions = [richTextKit, Markdown]

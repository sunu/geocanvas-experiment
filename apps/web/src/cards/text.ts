/** `text` cut at a word within `max` characters, with an ellipsis; as it is when it fits. */
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2))}…`
}

/**
 * Safari on iOS zooms the page into a text field whose text is smaller than 16px when it is focused, and leaves it
 * zoomed; most of the app's fields are 12 to 14px. `maximum-scale=1` stops that zoom only: since iOS 10 Safari still
 * lets people pinch to zoom whatever the viewport says. On Android it would stop pinch zoom too, so it is set on iOS
 * only.
 */

/** iPhone and iPod, and iPads, which say they are a Mac but have a touch screen. */
export const isIOS = (userAgent: string, maxTouchPoints: number) => /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)

export function stopInputZoom() {
  if (!isIOS(navigator.userAgent, navigator.maxTouchPoints)) return
  const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]')
  if (meta && !meta.content.includes('maximum-scale')) meta.content += ', maximum-scale=1'
}

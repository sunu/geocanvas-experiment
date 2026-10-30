/**
 * Keeps the phone's layout in the part of the screen the keyboard leaves. Chrome on Android resizes the page for the
 * keyboard (`interactive-widget=resizes-content` in index.html); Safari on iOS does not: it only shrinks the visual
 * viewport and scrolls it, so a prompt box at the bottom of a fixed layout ends up under the keyboard. This sets
 * --ttx-vv-top and --ttx-vv-height (mobile.css) from window.visualViewport. Returns the function that stops it.
 */
export function followVisualViewport(): () => void {
  const vv = window.visualViewport
  if (!vv) return () => {}
  const root = document.documentElement.style
  const update = () => {
    const area = keyboardArea(vv)
    if (area) {
      root.setProperty('--ttx-vv-top', `${area.top}px`)
      root.setProperty('--ttx-vv-height', `${area.height}px`)
    } else {
      root.removeProperty('--ttx-vv-top')
      root.removeProperty('--ttx-vv-height')
    }
  }
  update()
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  return () => {
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    root.removeProperty('--ttx-vv-top')
    root.removeProperty('--ttx-vv-height')
  }
}

/** Zoomed in further than this, the visual viewport is smaller because of the zoom, not the keyboard. */
const ZOOMED = 1.01

/**
 * Where the layout goes: the visual viewport, which the keyboard shrinks; or, while the person has zoomed in, nowhere
 * of its own (the whole screen). A zoomed-in visual viewport is small too, and a layout fitted to it would zoom with
 * it, so pinching back out could never show the whole screen again.
 */
export function keyboardArea(vv: Pick<VisualViewport, 'offsetTop' | 'height' | 'scale'>): { top: number; height: number } | undefined {
  return vv.scale > ZOOMED ? undefined : { top: vv.offsetTop, height: vv.height }
}

import { describe, expect, it } from 'vitest'
import { isIOS } from '../src/iosZoom'
import { keyboardArea } from '../src/mobile/viewport'

describe('isIOS', () => {
  it('knows iPhones, and iPads that say they are a Mac', () => {
    expect(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15', 5)).toBe(true)
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/19.0 Safari/605.1.15', 5)).toBe(true)
  })

  it('leaves Macs and Android alone', () => {
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/19.0 Safari/605.1.15', 0)).toBe(false)
    expect(isIOS('Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36', 5)).toBe(false)
  })
})

describe('keyboardArea', () => {
  it('fits the layout above the keyboard', () => {
    expect(keyboardArea({ offsetTop: 120, height: 420, scale: 1 })).toEqual({ top: 120, height: 420 })
  })

  it('gives the layout the whole screen back while the page is zoomed in', () => {
    expect(keyboardArea({ offsetTop: 300, height: 380, scale: 2 })).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { buildVersion, precacheList, type BundleFile } from '../src/pwa/precache'

const chunk = (fileName: string, more: Partial<BundleFile> = {}): BundleFile => ({ type: 'chunk', fileName, ...more })

describe('precacheList', () => {
  const bundle: Record<string, BundleFile> = {
    'assets/index.js': chunk('assets/index.js', { isEntry: true, imports: ['assets/react.js'], dynamicImports: ['assets/App.js', 'assets/MobileApp.js'], viteMetadata: { importedCss: new Set(['assets/index.css']) } }),
    'assets/react.js': chunk('assets/react.js'),
    'assets/App.js': chunk('assets/App.js', { imports: ['assets/plugins.js'], dynamicImports: ['assets/pdf.js'] }),
    'assets/MobileApp.js': chunk('assets/MobileApp.js', { imports: ['assets/plugins.js'], viteMetadata: { importedCss: new Set(['assets/MobileApp.css']) } }),
    'assets/plugins.js': chunk('assets/plugins.js'),
    'assets/pdf.js': chunk('assets/pdf.js'),
    'assets/index.css': { type: 'asset', fileName: 'assets/index.css' },
  }

  it('caches the page, the entry, both layouts and what they load at once, not what they load later', () => {
    expect(precacheList(bundle)).toEqual([
      '/',
      '/assets/App.js',
      '/assets/MobileApp.css',
      '/assets/MobileApp.js',
      '/assets/index.css',
      '/assets/index.js',
      '/assets/plugins.js',
      '/assets/react.js',
    ])
  })

  it('names a build by its files', () => {
    expect(buildVersion(bundle)).toBe(buildVersion({ ...bundle }))
    expect(buildVersion(bundle)).not.toBe(buildVersion({ ...bundle, 'assets/other.js': chunk('assets/other.js') }))
  })
})

import { defineConfig } from 'vitest/config'
import { mdText } from './packages/plugins/mdText.ts'

export default defineConfig({ plugins: [mdText] })

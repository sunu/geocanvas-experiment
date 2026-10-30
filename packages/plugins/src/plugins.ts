import { corePlugin } from '@ttx/core'
import { agentPlugin } from './agent.js'
import { eventsPlugin } from './events.js'
import { githubPlugin } from './github.js'
import { hapiPlugin } from './hapi.js'
import { ifrcgoPlugin } from './ifrcgo.js'
import { imagesPlugin } from './images.js'
import { inputsPlugin } from './inputs.js'
import { linksPlugin } from './links/index.js'
import { mapPlugin } from './map.js'
import { notebooksPlugin } from './notebooks.js'
import { pdfsPlugin } from './pdfs.js'
import { reliefwebPlugin } from './reliefweb.js'
import { openEOPlugin } from './openeo.js'
import { reportsPlugin } from './reports.js'
import { templatesPlugin } from './templates/index.js'

/**
 * The headless plugins: object types and ops, with no UI. The web app adds their UI
 * (apps/web/src/plugins.ts); the board's agent runs on them, in the room Durable Object or in a browser.
 */
export const plugins = [corePlugin, mapPlugin, eventsPlugin, notebooksPlugin, reliefwebPlugin, githubPlugin, ifrcgoPlugin, hapiPlugin, imagesPlugin, openEOPlugin, pdfsPlugin, inputsPlugin, linksPlugin, templatesPlugin, reportsPlugin, agentPlugin]

import { registerObjectUI } from '../canvas/registry'
import { PdfObject } from './PdfObject'
import { PdfOptions } from './PdfOptions'

// No toolbar tool: a PDF comes onto the board by dropping the file (uploads/drop.ts) or from the uploads gallery.
registerObjectUI('pdf', { View: PdfObject, Options: PdfOptions })

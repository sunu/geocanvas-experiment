import { registerObjectUI } from '../canvas/registry'
import { PdfObject } from './PdfObject'
import { PdfOptions } from './PdfOptions'

// No tool to draw: a PDF comes onto the board by dropping the file (uploads/drop.ts), from the toolbar's PDF button, or from the uploads gallery.
registerObjectUI('pdf', { View: PdfObject, Options: PdfOptions })

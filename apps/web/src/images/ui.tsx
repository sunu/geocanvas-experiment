import { ImageIcon } from '@phosphor-icons/react'
import { registerObjectUI } from '../canvas/registry'
import { ImageObject } from './ImageObject'

registerObjectUI('image', { View: ImageObject, tool: { key: 'I', label: 'Image', Icon: ImageIcon }, editable: true, editOnCreate: true })

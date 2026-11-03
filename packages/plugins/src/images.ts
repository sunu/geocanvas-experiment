import { z } from 'zod'
import { defineOp, definePlugin, UPLOAD_ID, uploadUrl, type AnyObject } from '@ttx/core'

/**
 * The image object type: a picture someone uploaded (a media upload, @ttx/core uploads.ts). No React
 * here: the view is registered in apps/web/src/images/ui.tsx. The board stores only the upload's id, and
 * its link is uploadUrl(id).
 *
 * Uploading and showing are separate steps. Uploading is not an op (ops only write the board): a client
 * posts the file to the Worker's /uploads and gets an id. Showing an uploaded image is an op, image.add
 * or image.setImage with that id, so the agent or any other client can place an image someone uploaded.
 */

/** imageId is absent until someone uploads a file; name is the uploaded file's name. */
export type ImageBoardObject = AnyObject & { type: 'image'; imageId?: string; name?: string }

const imageId = z.string().regex(UPLOAD_ID).describe('Id of an uploaded image: the <id> in its link /uploads/<id>')

export const imagesPlugin = definePlugin({
  id: 'images',
  title: 'Images',
  description: 'Pictures uploaded to the board.',
  optional: true,
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'image',
      title: 'Image',
      description: 'A picture uploaded by someone on the board (PNG, JPEG, GIF or WebP).',
      fields: z.object({ imageId: imageId.optional(), name: z.string().optional().describe('File name, shown as its title') }),
      defaultSize: { w: 320, h: 240 },
      layer: 'top',
      summarize: (o) => {
        const { imageId, name } = o as ImageBoardObject
        return imageId ? `image${name ? ` "${name}"` : ''}, link ${uploadUrl(imageId)}` : 'no image uploaded yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'image.setImage',
      title: 'Set image',
      description: 'Show an uploaded image in the selected image object, replacing its picture.',
      target: { kind: 'objects', types: ['image'], max: 1 },
      args: z.object({ imageId, name: z.string().optional().describe('File name, shown as its title') }),
      apply: (tx, { imageId, name }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { imageId, name } }),
    }),
  ],
})

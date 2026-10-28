import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'

/**
 * The image object type: a picture someone uploaded. No React here: the view is registered in
 * apps/web/src/images/ui.tsx. The file is in the Worker's R2 bucket (apps/worker/src/images.ts); the
 * board stores only its id, and its link is imageUrl(id).
 *
 * Uploading and showing are separate steps. Uploading is not an op (ops only write the board): a client
 * posts the file to the Worker's /images and gets an id. Showing an uploaded image is an op, image.add
 * or image.setImage with that id, so the agent or any other client can place an image someone uploaded.
 */

/** imageId is absent until someone uploads a file; name is the uploaded file's name. */
export type ImageBoardObject = AnyObject & { type: 'image'; imageId?: string; name?: string }

/** The largest file the Worker stores. The browser checks it too, before uploading. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Ids are random UUIDs made by the Worker: unguessable, so a link is the only way to an image. */
export const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const imageId = z.string().regex(IMAGE_ID).describe('Id of an uploaded image: the <id> in its link /images/<id>')

/** An image's link, relative to the board's origin. */
export const imageUrl = (id: string) => `/images/${id}`

export const imagesPlugin = definePlugin({
  id: 'images',
  title: 'Images',
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
        return imageId ? `image${name ? ` "${name}"` : ''}, link ${imageUrl(imageId)}` : 'no image uploaded yet'
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

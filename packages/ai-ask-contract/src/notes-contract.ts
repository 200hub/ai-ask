import { apiContract } from '@h-ai/api-contract'
import { z } from 'zod'
import { noteRowSchema, notesPushInputSchema } from './notes-schemas.js'

export const notesContract = {
  list: apiContract.route({ method: 'POST', path: '/notes/list' })
    .input(z.object({}))
    .output(apiContract.haiResultSchema(z.array(noteRowSchema))),
  push: apiContract.route({ method: 'POST', path: '/notes/push' })
    .input(notesPushInputSchema)
    .output(apiContract.haiResultSchema(z.array(noteRowSchema))),
}

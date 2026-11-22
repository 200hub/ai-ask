import type { ServContext } from '@h-ai/serv'
import { serv } from '@h-ai/serv'
import { notesContract } from 'ai-ask-contract'
import { listNotes, pushNotes } from '../notes-service.js'

export function createNotesProcedures() {
  return serv.implement(notesContract).context<ServContext>().route('list').auth().handle(({ context }) => listNotes(context.session.userId)).route('push').auth().handle(({ input, context }) => pushNotes(context.session.userId, input.notes)).build()
}

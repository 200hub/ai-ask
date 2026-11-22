import { apiContract } from '@h-ai/api-contract'
import { notesContract } from './notes-contract.js'

/** 工程统一契约，包含标准 IAM 与便签业务接口。 */
export const syncContract = apiContract.create({
  iam: apiContract.iam,
  notes: notesContract,
})

export type AiAskContract = typeof syncContract

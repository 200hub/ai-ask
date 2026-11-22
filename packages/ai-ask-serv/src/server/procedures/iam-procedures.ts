import type { ServContext } from '@h-ai/serv'
import { iam } from '@h-ai/iam'
import { serv } from '@h-ai/serv'
import { createIamProcedures } from '@h-ai/serv/features/iam'
import { syncContract } from 'ai-ask-contract'

/** beta.35 的 Serv 默认更新仍拆分资料和角色；仅替换该路由，其余保持框架实现。 */
export function createApplicationIamProcedures() {
  const standard = createIamProcedures({ iam })
  const atomic = serv.implement({ users: { update: syncContract.iam.users.update } })
    .context<ServContext>()
    .route('users.update')
    .permission('iam.users.write')
    .handle(async ({ input, context }) => {
      // 与默认 procedure 相同：权限通过后才校验本次敏感操作，不提升已有授权。
      if (iam.publicConfig?.reauthentication?.enabled) {
        const checked = await iam.auth.checkSensitiveOperation(
          context.accessToken ?? '',
          'iam.users.update',
          context.request.headers.get('x-hai-reauthentication') ?? undefined,
        )
        if (!checked.success)
          return checked
      }
      const { id, roleIds, ...profile } = input
      // 必须走已装配审计钩子的公开 IAM API，不直接改用户表或角色关系。
      return iam.user.updateUserWithRoles(id, { profile, roleIds })
    })
    .build()
  return { ...standard, users: { ...standard.users, ...atomic.users } }
}

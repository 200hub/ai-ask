/**
 * Supabase 客户端初始化与认证工具
 *
 * 说明：
 * - 使用 @supabase/supabase-js 创建单例客户端
 * - 认证采用邮箱+密码方式（桌面应用最简洁的方案，无需 deep link）
 * - Session 自动持久化到 localStorage（Supabase SDK 默认行为）
 * - URL 和 Anon Key 从 constants.ts 中读取，所有用户共享同一个后端
 */
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js'

import { SUPABASE } from '$lib/utils/constants'

import { logger } from '$lib/utils/logger'
import { createClient } from '@supabase/supabase-js'

/**
 * Supabase 用户会话信息（前端使用）
 */
export interface SupabaseSessionInfo {
  authenticated: boolean
  email: string | null
  userId: string | null
}

/** Supabase 单例客户端 */
let client: SupabaseClient | null = null

/**
 * 检查云同步后端是否可用
 *
 * 开发阶段 URL/ANON_KEY 可能为空，此时同步功能会被优雅地隐藏。
 * 打包发布的应用中一定已经内置了实际值，用户无需任何配置。
 */
export function isSupabaseAvailable(): boolean {
  return SUPABASE.URL.length > 0 && SUPABASE.ANON_KEY.length > 0
}

/**
 * 获取 Supabase 客户端单例
 *
 * 调用前应先用 isSupabaseAvailable() 检查。
 * 如果未配置则抛出异常（仅在开发阶段会触发）。
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client
  }

  const url = SUPABASE.URL
  const anonKey = SUPABASE.ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Cloud sync backend not available')
  }

  client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      // Supabase SDK 默认用 localStorage 存储 session
      // 在 Tauri webview 中，localStorage 跟随 origin 隔离，安全可用
    },
  })

  logger.info('Supabase client initialized')
  return client
}

/**
 * 获取当前用户的会话信息
 */
export async function getSessionInfo(): Promise<SupabaseSessionInfo> {
  try {
    const supabase = getSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return { authenticated: false, email: null, userId: null }
    }

    return {
      authenticated: true,
      email: session.user.email ?? null,
      userId: session.user.id,
    }
  }
  catch {
    return { authenticated: false, email: null, userId: null }
  }
}

/**
 * 获取当前 session（可能为 null）
 */
export async function getCurrentSession(): Promise<Session | null> {
  try {
    const supabase = getSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }
  catch {
    return null
  }
}

/**
 * 获取当前 User（可能为 null）
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getCurrentSession()
  return session?.user ?? null
}

/**
 * 邮箱注册
 */
export async function signUpWithEmail(email: string, password: string): Promise<SupabaseSessionInfo> {
  const supabase = getSupabaseClient()

  // 桌面应用中邮件验证回调 URL 不可达，使用 Supabase 项目 URL 作为 fallback
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: SUPABASE.URL ? `${SUPABASE.URL}/` : undefined,
    },
  })

  if (error) {
    logger.error('Supabase sign-up failed', { message: error.message })
    throw new Error(error.message)
  }

  if (!data.user) {
    throw new Error('Sign-up succeeded but no user returned')
  }

  logger.info('Supabase sign-up succeeded', { userId: data.user.id })

  return {
    authenticated: !!data.session,
    email: data.user.email ?? null,
    userId: data.user.id,
  }
}

/**
 * 邮箱登录
 */
export async function signInWithEmail(email: string, password: string): Promise<SupabaseSessionInfo> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    logger.error('Supabase sign-in failed', { message: error.message })
    throw new Error(error.message)
  }

  logger.info('Supabase sign-in succeeded', { userId: data.user.id })

  return {
    authenticated: true,
    email: data.user.email ?? null,
    userId: data.user.id,
  }
}

/**
 * 退出登录
 */
export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient()

  const { error } = await supabase.auth.signOut()

  if (error) {
    logger.error('Supabase sign-out failed', { message: error.message })
    throw new Error(error.message)
  }

  logger.info('Supabase sign-out succeeded')
}

/**
 * 监听认证状态变化
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  const supabase = getSupabaseClient()
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback)
  return () => subscription.unsubscribe()
}

/**
 * 密码重置（发送重置邮件）
 */
export async function resetPassword(email: string): Promise<void> {
  const supabase = getSupabaseClient()

  // 重定向 URL 设为 Supabase 默认（用户在浏览器完成重置即可）
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: SUPABASE.PASSWORD_RESET_REDIRECT_URL,
  })

  if (error) {
    logger.error('Supabase password reset failed', { message: error.message })
    throw new Error(error.message)
  }

  logger.info('Supabase password reset email sent', { email })
}

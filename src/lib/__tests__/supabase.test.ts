/**
 * supabase.ts 单元测试
 *
 * 覆盖：
 * - getSupabaseClient: 单例创建
 * - getSessionInfo: 会话信息获取
 * - signUpWithEmail: 注册
 * - signInWithEmail: 登录
 * - signOut: 退出
 * - resetPassword: 密码重置
 * - 各函数的错误处理
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Supabase 客户端
const mockAuth = {
  getSession: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}

const mockClient = {
  auth: mockAuth,
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient),
}))

vi.mock('$lib/utils/constants', () => ({
  SUPABASE: {
    URL: 'https://test-project.supabase.co',
    ANON_KEY: 'test-anon-key-1234567890',
    NOTES_TABLE: 'desktop_notes',
    SOFT_DELETE_RETENTION_DAYS: 30,
    PASSWORD_RESET_REDIRECT_URL: '',
    PASSWORD_MIN_LENGTH: 6,
  },
}))

vi.mock('$lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

let supabaseModule: typeof import('$lib/utils/supabase')

beforeEach(async () => {
  vi.resetModules()

  // 重置 mock 返回值
  mockAuth.getSession.mockReset()
  mockAuth.signUp.mockReset()
  mockAuth.signInWithPassword.mockReset()
  mockAuth.signOut.mockReset()
  mockAuth.onAuthStateChange.mockReset()
  mockAuth.resetPasswordForEmail.mockReset()

  supabaseModule = await import('$lib/utils/supabase')
})

describe('isSupabaseAvailable', () => {
  it('should return true when URL and ANON_KEY are configured', () => {
    // constants mock 提供了非空的 URL 和 ANON_KEY
    expect(supabaseModule.isSupabaseAvailable()).toBe(true)
  })
})

describe('getSupabaseClient', () => {
  it('should create and return a client when constants are configured', () => {
    const client = supabaseModule.getSupabaseClient()
    expect(client).toBeDefined()
    expect(client.auth).toBeDefined()
  })
})

describe('getSessionInfo', () => {
  it('should return authenticated session when user exists', async () => {
    mockAuth.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'user-123',
            email: 'test@example.com',
          },
        },
      },
    })

    const result = await supabaseModule.getSessionInfo()

    expect(result).toEqual({
      authenticated: true,
      email: 'test@example.com',
      userId: 'user-123',
    })
  })

  it('should return unauthenticated when no session', async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: null },
    })

    const result = await supabaseModule.getSessionInfo()

    expect(result).toEqual({
      authenticated: false,
      email: null,
      userId: null,
    })
  })

  it('should return unauthenticated on error', async () => {
    mockAuth.getSession.mockRejectedValue(new Error('Network error'))

    const result = await supabaseModule.getSessionInfo()

    expect(result).toEqual({
      authenticated: false,
      email: null,
      userId: null,
    })
  })
})

describe('getCurrentSession', () => {
  it('should return session when authenticated', async () => {
    const mockSession = { user: { id: '123' }, access_token: 'abc' }
    mockAuth.getSession.mockResolvedValue({
      data: { session: mockSession },
    })

    const result = await supabaseModule.getCurrentSession()
    expect(result).toEqual(mockSession)
  })

  it('should return null when no session', async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: null },
    })

    const result = await supabaseModule.getCurrentSession()
    expect(result).toBeNull()
  })

  it('should return null on error', async () => {
    mockAuth.getSession.mockRejectedValue(new Error('fail'))

    const result = await supabaseModule.getCurrentSession()
    expect(result).toBeNull()
  })
})

describe('getCurrentUser', () => {
  it('should return user from session', async () => {
    const mockUser = { id: 'user-1', email: 'a@b.com' }
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: mockUser } },
    })

    const result = await supabaseModule.getCurrentUser()
    expect(result).toEqual(mockUser)
  })

  it('should return null when no session', async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: null },
    })

    const result = await supabaseModule.getCurrentUser()
    expect(result).toBeNull()
  })
})

describe('signUpWithEmail', () => {
  it('should return session info on success', async () => {
    mockAuth.signUp.mockResolvedValue({
      data: {
        user: { id: 'new-user', email: 'new@test.com' },
        session: { access_token: 'token' },
      },
      error: null,
    })

    const result = await supabaseModule.signUpWithEmail('new@test.com', 'password123')

    expect(result).toEqual({
      authenticated: true,
      email: 'new@test.com',
      userId: 'new-user',
    })
    expect(mockAuth.signUp).toHaveBeenCalledWith({
      email: 'new@test.com',
      password: 'password123',
      options: {
        emailRedirectTo: expect.any(String),
      },
    })
  })

  it('should return unauthenticated when email confirmation needed', async () => {
    mockAuth.signUp.mockResolvedValue({
      data: {
        user: { id: 'new-user', email: 'new@test.com' },
        session: null, // 需要邮箱确认，没有立即生成 session
      },
      error: null,
    })

    const result = await supabaseModule.signUpWithEmail('new@test.com', 'password123')

    expect(result).toEqual({
      authenticated: false,
      email: 'new@test.com',
      userId: 'new-user',
    })
  })

  it('should throw on sign-up error', async () => {
    mockAuth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email already registered' },
    })

    await expect(
      supabaseModule.signUpWithEmail('dup@test.com', 'password123'),
    ).rejects.toThrow('Email already registered')
  })

  it('should throw when no user returned', async () => {
    mockAuth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    })

    await expect(
      supabaseModule.signUpWithEmail('x@test.com', 'pass'),
    ).rejects.toThrow('Sign-up succeeded but no user returned')
  })
})

describe('signInWithEmail', () => {
  it('should return session info on success', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'user@test.com' },
        session: { access_token: 'token' },
      },
      error: null,
    })

    const result = await supabaseModule.signInWithEmail('user@test.com', 'pass')

    expect(result).toEqual({
      authenticated: true,
      email: 'user@test.com',
      userId: 'user-1',
    })
  })

  it('should throw on invalid credentials', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    })

    await expect(
      supabaseModule.signInWithEmail('user@test.com', 'wrong'),
    ).rejects.toThrow('Invalid login credentials')
  })
})

describe('signOut', () => {
  it('should resolve on success', async () => {
    mockAuth.signOut.mockResolvedValue({ error: null })

    await expect(supabaseModule.signOut()).resolves.not.toThrow()
    expect(mockAuth.signOut).toHaveBeenCalled()
  })

  it('should throw on error', async () => {
    mockAuth.signOut.mockResolvedValue({
      error: { message: 'Session expired' },
    })

    await expect(supabaseModule.signOut()).rejects.toThrow('Session expired')
  })
})

describe('onAuthStateChange', () => {
  it('should subscribe and return unsubscribe function', () => {
    const mockUnsubscribe = vi.fn()
    mockAuth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    })

    const callback = vi.fn()
    const unsub = supabaseModule.onAuthStateChange(callback)

    expect(mockAuth.onAuthStateChange).toHaveBeenCalledWith(callback)
    expect(typeof unsub).toBe('function')

    unsub()
    expect(mockUnsubscribe).toHaveBeenCalled()
  })
})

describe('resetPassword', () => {
  it('should resolve on success', async () => {
    mockAuth.resetPasswordForEmail.mockResolvedValue({ error: null })

    await expect(
      supabaseModule.resetPassword('user@test.com'),
    ).resolves.not.toThrow()
    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith(
      'user@test.com',
      { redirectTo: '' },
    )
  })

  it('should throw on error', async () => {
    mockAuth.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'Rate limit exceeded' },
    })

    await expect(
      supabaseModule.resetPassword('user@test.com'),
    ).rejects.toThrow('Rate limit exceeded')
  })
})

#!/usr/bin/env node
/**
 * Supabase 项目自动化设置脚本（开发者工具，非面向终端用户）
 *
 * 功能：
 * 1. 使用 Supabase Management API 创建项目（或连接已有项目）
 * 2. 等待项目就绪
 * 3. 自动运行 SQL 迁移（创建 desktop_notes 表、RLS 策略、索引、Realtime）
 * 4. 获取 API URL 和 Anon Key 并写入 constants.ts
 *
 * 使用方式（仅开发者首次部署时运行一次）：
 *   pnpm supabase:setup
 *
 * 运行后将 URL 和 Anon Key 写入 src/lib/utils/constants.ts，
 * 提交代码并打包后，所有用户即可直接使用云同步功能。
 *
 * 前置条件：
 *   在 https://supabase.com/dashboard/account/tokens 创建 Access Token
 */
import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

// Supabase Management API 基础地址
const SUPABASE_API_BASE = 'https://api.supabase.com'

// 默认配置
const DEFAULT_REGION = 'ap-northeast-1'
const DEFAULT_PROJECT_NAME = 'ai-ask-notes'
const PROJECT_READY_POLL_INTERVAL_MS = 5000
const PROJECT_READY_TIMEOUT_MS = 120000

// ==================== 工具函数 ====================

/**
 * 创建 readline 接口用于终端交互
 */
function createPrompt() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

/**
 * 封装 readline 为 Promise
 */
function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim())
    })
  })
}

/**
 * 调用 Supabase Management API
 */
async function supabaseApi(token, path, options = {}) {
  const url = `${SUPABASE_API_BASE}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API ${options.method || 'GET'} ${path} failed (${response.status}): ${body}`)
  }

  // 204 No Content
  if (response.status === 204) {
    return null
  }

  return response.json()
}

/**
 * 读取 SQL 迁移文件
 */
function readMigrationSQL() {
  const sqlPath = join(PROJECT_ROOT, 'supabase', 'migrations', '001_desktop_notes.sql')
  if (!existsSync(sqlPath)) {
    throw new Error(`Migration file not found: ${sqlPath}`)
  }
  return readFileSync(sqlPath, 'utf-8')
}

/**
 * 将 URL 和 Anon Key 写入 constants.ts 的 SUPABASE 常量中
 */
function writeConstants(url, anonKey) {
  const constantsPath = join(PROJECT_ROOT, 'src', 'lib', 'utils', 'constants.ts')
  if (!existsSync(constantsPath)) {
    throw new Error(`constants.ts not found: ${constantsPath}`)
  }

  let content = readFileSync(constantsPath, 'utf-8')

  // 替换 SUPABASE.URL 字段（精确匹配 SUPABASE 常量块内的 URL 字段）
  content = content.replace(
    /(export const SUPABASE = \{[\s\S]*?)URL:\s*'[^']*'/,
    `$1URL: '${url}'`,
  )

  // 替换 SUPABASE.ANON_KEY 字段
  content = content.replace(
    /(export const SUPABASE = \{[\s\S]*?)ANON_KEY:\s*'[^']*'/,
    `$1ANON_KEY: '${anonKey}'`,
  )

  writeFileSync(constantsPath, content, 'utf-8')
  console.log(`\n✅ constants.ts 已更新: ${constantsPath}`)
}

// ==================== API 操作 ====================

/**
 * 获取用户的组织列表
 */
async function listOrganizations(token) {
  return supabaseApi(token, '/v1/organizations')
}

/**
 * 获取组织下的项目列表
 */
async function listProjects(token) {
  return supabaseApi(token, '/v1/projects')
}

/**
 * 创建新项目
 */
async function createProject(token, { name, organizationId, region, dbPassword }) {
  return supabaseApi(token, '/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      organization_id: organizationId,
      region,
      db_pass: dbPassword,
      plan: 'free',
    }),
  })
}

/**
 * 获取项目详情
 */
async function getProject(token, projectRef) {
  return supabaseApi(token, `/v1/projects/${projectRef}`)
}

/**
 * 获取项目 API Keys
 */
async function getApiKeys(token, projectRef) {
  return supabaseApi(token, `/v1/projects/${projectRef}/api-keys`)
}

/**
 * 在项目数据库上执行 SQL
 */
async function runSQL(token, projectRef, sql) {
  return supabaseApi(token, `/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: sql }),
  })
}

/**
 * 等待项目就绪
 */
async function waitForProjectReady(token, projectRef) {
  const startTime = Date.now()
  process.stdout.write('⏳ 等待项目就绪')

  while (Date.now() - startTime < PROJECT_READY_TIMEOUT_MS) {
    const project = await getProject(token, projectRef)

    if (project.status === 'ACTIVE_HEALTHY') {
      console.log(' ✅')
      return project
    }

    process.stdout.write('.')
    await new Promise(resolve => setTimeout(resolve, PROJECT_READY_POLL_INTERVAL_MS))
  }

  throw new Error('项目创建超时，请在 Supabase Dashboard 中检查状态')
}

// ==================== 生成密码 ====================

/**
 * 生成安全的数据库密码
 */
function generatePassword(length = 24) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => charset[b % charset.length]).join('')
}

// ==================== 主流程 ====================

async function main() {
  console.log('🚀 Supabase 项目自动化设置')
  console.log('=' .repeat(50))
  console.log()

  const rl = createPrompt()

  try {
    // 1. 获取 Access Token
    console.log('📋 步骤 1: Supabase Access Token')
    console.log('   请前往 https://supabase.com/dashboard/account/tokens 创建')
    const token = await ask(rl, '\n请输入 Access Token: ')
    if (!token) {
      throw new Error('Access Token 不能为空')
    }

    // 2. 选择：创建新项目 or 使用已有项目
    console.log('\n📋 步骤 2: 选择项目')
    const mode = await ask(rl, '创建新项目(n) 还是使用已有项目(e)? [n/e]: ')

    let projectRef
    let apiUrl

    if (mode.toLowerCase() === 'e') {
      // 使用已有项目
      console.log('\n正在获取项目列表...')
      const projects = await listProjects(token)

      if (!projects || projects.length === 0) {
        throw new Error('没有找到任何项目，请先创建一个')
      }

      console.log('\n可用项目:')
      projects.forEach((p, i) => {
        console.log(`  [${i + 1}] ${p.name} (${p.ref}) - ${p.region}`)
      })

      const choice = await ask(rl, `\n选择项目编号 [1-${projects.length}]: `)
      const idx = parseInt(choice, 10) - 1

      if (idx < 0 || idx >= projects.length) {
        throw new Error('无效的选择')
      }

      projectRef = projects[idx].ref
      apiUrl = `https://${projectRef}.supabase.co`
      console.log(`\n✅ 已选择: ${projects[idx].name}`)
    } else {
      // 创建新项目
      console.log('\n正在获取组织列表...')
      const orgs = await listOrganizations(token)

      if (!orgs || orgs.length === 0) {
        throw new Error('没有找到组织，请先在 Supabase Dashboard 中创建')
      }

      let orgId
      if (orgs.length === 1) {
        orgId = orgs[0].id
        console.log(`使用组织: ${orgs[0].name}`)
      } else {
        console.log('\n可用组织:')
        orgs.forEach((o, i) => {
          console.log(`  [${i + 1}] ${o.name}`)
        })
        const orgChoice = await ask(rl, `\n选择组织编号 [1-${orgs.length}]: `)
        const orgIdx = parseInt(orgChoice, 10) - 1
        if (orgIdx < 0 || orgIdx >= orgs.length) {
          throw new Error('无效的选择')
        }
        orgId = orgs[orgIdx].id
      }

      const projectName = (await ask(rl, `\n项目名称 [${DEFAULT_PROJECT_NAME}]: `)) || DEFAULT_PROJECT_NAME
      const region = (await ask(rl, `区域 [${DEFAULT_REGION}]: `)) || DEFAULT_REGION
      const dbPassword = generatePassword()

      console.log(`\n正在创建项目 "${projectName}" (${region})...`)
      const project = await createProject(token, {
        name: projectName,
        organizationId: orgId,
        region,
        dbPassword,
      })

      projectRef = project.ref || project.id
      apiUrl = `https://${projectRef}.supabase.co`

      // 等待项目就绪
      await waitForProjectReady(token, projectRef)
    }

    // 3. 运行 SQL 迁移
    console.log('\n📋 步骤 3: 运行数据库迁移')
    const migrationSQL = readMigrationSQL()

    console.log('正在执行迁移...')
    await runSQL(token, projectRef, migrationSQL)
    console.log('✅ 数据库迁移完成')

    // 3.5 配置 Auth：桌面应用无法处理邮件验证回调，禁用邮箱确认
    console.log('\n📋 步骤 3.5: 配置 Auth（禁用邮箱确认）')
    try {
      await supabaseApi(token, `/v1/projects/${projectRef}/config/auth`, {
        method: 'PATCH',
        body: JSON.stringify({
          MAILER_AUTOCONFIRM: true,
          SITE_URL: apiUrl,
        }),
      })
      console.log('✅ Auth 配置完成：邮箱注册后自动确认（桌面应用无需邮件验证）')
    } catch (err) {
      console.warn(`⚠️  Auth 配置失败（非致命）: ${err.message}`)
      console.warn('   请手动在 Supabase Dashboard > Auth > Settings 中禁用 "Enable email confirmations"')
    }

    // 4. 获取 API Keys
    console.log('\n📋 步骤 4: 获取 API 配置')
    const apiKeys = await getApiKeys(token, projectRef)
    const anonKeyEntry = apiKeys.find(k => k.name === 'anon')

    if (!anonKeyEntry) {
      throw new Error('未找到 anon key，请在 Dashboard 手动获取')
    }

    // 5. 写入 constants.ts
    writeConstants(apiUrl, anonKeyEntry.api_key)

    console.log(`\n${'='.repeat(50)}`)
    console.log('🎉 设置完成！')
    console.log()
    console.log(`   项目 Ref:    ${projectRef}`)
    console.log(`   API URL:     ${apiUrl}`)
    console.log(`   Anon Key:    ${anonKeyEntry.api_key.substring(0, 20)}...`)
    console.log()
    console.log('   URL 和 Anon Key 已写入 src/lib/utils/constants.ts')
    console.log('   现在可以运行 `pnpm tauri dev` 启动应用')
    console.log(`${'='.repeat(50)}`)
  } catch (error) {
    console.error(`\n❌ 错误: ${error.message}`)
    process.exit(1)
  } finally {
    rl.close()
  }
}

main()

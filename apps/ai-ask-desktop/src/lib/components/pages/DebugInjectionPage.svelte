<script lang='ts'>
  import type { InjectionResult } from '$lib/types/injection'
  import type { AIPlatform } from '$lib/types/platform'
  import { i18n } from '$lib/i18n'
  import { appState } from '$lib/stores/app.svelte'
  import { calculateChildWebviewBounds, ChildWebviewProxy } from '$lib/utils/childWebview'
  import { BUILT_IN_AI_PLATFORMS, DEBUG_FLOATING_CONTROLS_OFFSET, DEBUG_INJECTION, EVENTS } from '$lib/utils/constants'
  import { generateInjectionScript, injectionManager } from '$lib/utils/injection'
  import { formatExtractedContent, getExtractedDisplayText } from '$lib/utils/injection-format'
  import { subscribeInjectionResults } from '$lib/utils/injection-result'
  import { ALL_TEMPLATES } from '$lib/utils/injection-templates'
  import { logger } from '$lib/utils/logger'

  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
  /**
   * 注入调试页面 - 测试 WebView 自动注入功能
   */
  import { onDestroy, onMount, tick } from 'svelte'

  const t = i18n.t

  let webviewProxy = $state<ChildWebviewProxy | null>(null)
  let selectedPlatform = $state<AIPlatform | null>(null)
  let message = $state('')
  let loading = $state(false)
  let result = $state<InjectionResult | null>(null)
  let logs = $state<Array<{ time: string, type: string, message: string }>>([])
  let showWebview = $state(false) // 是否显示 webview（隐藏控制面板）
  let shouldRestoreWebview = false // 是否在恢复事件后重新显示 webview
  let extractedContent = $state<string>('') // 提取的内容
  let activeWebviewId: string | null = null
  let disposed = false

  function receiveInjectionResult(parsed: InjectionResult) {
    result = parsed
    const extract = parsed.results?.find(action => action.type === 'extract' && action.result.success)
    if (extract) {
      const formatted = formatExtractedContent(extract.result)
      const displayText = getExtractedDisplayText(extract.result)
      if (formatted && displayText) {
        extractedContent = displayText
        addLog('success', `${t('debug.extracted')}: ${formatted.format}, ${displayText.length} ${t('debug.characters')}`)
      }
    }
    addLog(parsed.success ? 'success' : 'error', parsed.success
      ? `${t('debug.injectionSuccess')} (${parsed.duration ?? 0}ms)`
      : `${t('debug.injectionFailed')}: ${parsed.error ?? t('errors.unknownError')}`)
  }

  function handleHideAllWebviewsEvent(event: Event) {
    const customEvent = event as CustomEvent<{ markForRestore?: boolean }>
    const markForRestore = customEvent.detail?.markForRestore ?? true

    shouldRestoreWebview = Boolean(markForRestore && webviewProxy && showWebview)

    if (webviewProxy) {
      webviewProxy.hide().catch((err) => {
        logger.error('Failed to hide debug webview via event', err)
      })
    }

    showWebview = false
  }

  function handleRestoreWebviewsEvent() {
    if (!shouldRestoreWebview || !webviewProxy) {
      return
    }

    shouldRestoreWebview = false
    void showWebviewAgain()
  }

  // 注册所有内置模板
  onMount(() => {
    ALL_TEMPLATES.forEach((template) => {
      injectionManager.registerTemplate(template)
    })
    addLog('info', t('debug.initialized'))

    window.addEventListener(EVENTS.HIDE_ALL_WEBVIEWS, handleHideAllWebviewsEvent as (e: Event) => void)
    window.addEventListener(EVENTS.RESTORE_WEBVIEWS, handleRestoreWebviewsEvent as (e: Event) => void)

    const mainWindow = getCurrentWebviewWindow()
    const subscription = subscribeInjectionResults(
      receive => mainWindow.listen<unknown>(EVENTS.CHILD_WEBVIEW_INJECTION_RESULT, ev => receive(ev.payload)),
      () => activeWebviewId,
      receiveInjectionResult,
    )
    subscription.ready.then(() => {
      if (!disposed)
        addLog('info', t('debug.listenerReady'))
    }).catch((error) => {
      logger.error('Failed to register debug injection listener', { error })
      if (!disposed)
        addLog('error', t('debug.listenerFailed'))
    })

    return () => {
      window.removeEventListener(
        EVENTS.HIDE_ALL_WEBVIEWS,
        handleHideAllWebviewsEvent as (e: Event) => void,
      )
      window.removeEventListener(
        EVENTS.RESTORE_WEBVIEWS,
        handleRestoreWebviewsEvent as (e: Event) => void,
      )
      subscription.dispose()
    }
  })

  onDestroy(() => {
    disposed = true
    activeWebviewId = null
    if (webviewProxy) {
      webviewProxy.close().catch((err) => {
        logger.error('Failed to close webview', err)
      })
    }
  })

  /**
   * 添加日志
   */
  function addLog(type: string, message: string) {
    const time = new Date().toLocaleTimeString()
    if (!disposed)
      logs = [...logs, { time, type, message }].slice(-DEBUG_INJECTION.MAX_LOG_ENTRIES)
  }

  /**
   * 清空日志
   */
  function clearLogs() {
    logs = []
  }

  /**
   * 初始化 WebView
   */
  async function initializeWebview() {
    if (loading || disposed)
      return
    if (!selectedPlatform) {
      addLog('error', t('debug.selectPlatformFirst'))
      return
    }

    const platform = selectedPlatform
    let candidate: ChildWebviewProxy | undefined
    try {
      loading = true
      result = null
      extractedContent = ''
      activeWebviewId = null
      // 切换目标前等待旧窗口关闭；关闭失败时保留代理，避免遗留无法管理的窗口。
      await webviewProxy?.close()
      webviewProxy = null
      if (disposed)
        return
      addLog('info', `${t('debug.initializing')} ${platform.name}...`)

      // 切换到 webview 显示模式
      showWebview = true

      await tick()
      if (disposed)
        return

      const mainWindow = getCurrentWebviewWindow()
      const bounds = await calculateChildWebviewBounds(mainWindow)
      // Reserve space at the top for floating controls bar
      bounds.positionLogical.y += DEBUG_FLOATING_CONTROLS_OFFSET
      bounds.sizeLogical.height = Math.max(0, bounds.sizeLogical.height - DEBUG_FLOATING_CONTROLS_OFFSET)

      // 创建并初始化 webview - 使用 debug- 前缀避免与正常平台冲突
      const debugWebviewId = `${DEBUG_INJECTION.WEBVIEW_PREFIX}${platform.id}`
      candidate = new ChildWebviewProxy(debugWebviewId, platform.url, null)
      webviewProxy = candidate
      activeWebviewId = debugWebviewId
      await candidate.ensure(bounds)
      if (disposed) {
        await candidate.close()
        return
      }
      await candidate.show()

      addLog('info', t('debug.webviewCreated'))

      // 等待页面加载
      addLog('info', t('debug.waitingForPage'))
      const ready = await candidate.waitForLoadFinished(DEBUG_INJECTION.LOAD_TIMEOUT_MS)
      if (disposed) {
        await candidate.close()
        return
      }
      if (!ready)
        throw new Error(t('debug.loadTimeout'))

      addLog('success', t('debug.pageLoaded'))
    }
    catch (error) {
      activeWebviewId = null
      if (candidate) {
        try {
          await candidate.close()
          if (webviewProxy === candidate)
            webviewProxy = null
        }
        catch (cleanupError) {
          logger.error('Failed to close unready debug webview', { cleanupError })
        }
      }
      addLog('error', `${t('debug.initFailed')}: ${error}`)
      result = {
        success: false,
        error: String(error),
      }
      showWebview = false // 失败时回到控制面板
    }
    finally {
      loading = false
    }
  }

  /**
   * 隐藏 WebView，回到控制面板
   */
  function hideWebview() {
    shouldRestoreWebview = false
    showWebview = false
    if (webviewProxy) {
      webviewProxy.hide().catch((err) => {
        logger.error('Failed to hide webview', err)
      })
    }
  }

  /**
   * 显示 WebView
   */
  async function showWebviewAgain() {
    if (!webviewProxy)
      return

    try {
      showWebview = true
      await tick()

      const mainWindow = getCurrentWebviewWindow()
      const bounds = await calculateChildWebviewBounds(mainWindow)
      // Reserve space at the top for floating controls bar
      bounds.positionLogical.y += DEBUG_FLOATING_CONTROLS_OFFSET
      bounds.sizeLogical.height = Math.max(0, bounds.sizeLogical.height - DEBUG_FLOATING_CONTROLS_OFFSET)
      await webviewProxy.updateBounds(bounds)
      await webviewProxy.show()
    }
    catch (error) {
      logger.error('Failed to show webview', error)
      showWebview = false
    }
  }

  /**
   * 关闭 WebView
   */
  async function closeWebview() {
    if (!webviewProxy)
      return

    try {
      activeWebviewId = null
      addLog('info', t('debug.closingWebview'))
      await webviewProxy.close()
      webviewProxy = null
      showWebview = false
      shouldRestoreWebview = false
      addLog('success', t('debug.webviewClosed'))
    }
    catch (error) {
      addLog('error', `${t('debug.closeFailed')}: ${error}`)
    }
  }

  async function changePlatform() {
    if (!webviewProxy)
      return
    if (selectedPlatform)
      await initializeWebview()
    else
      await closeWebview()
  }

  /**
   * 测试简单脚本执行
   */
  async function testSimpleScript() {
    if (!webviewProxy) {
      addLog('error', t('debug.selectPlatformFirst'))
      return
    }

    try {
      loading = true
      addLog('info', t('debug.testScript'))

      result = null
      const simpleScript = generateInjectionScript([{
        type: 'extract',
        extractScript: `() => ${JSON.stringify(t('debug.simpleTestReply'))}`,
        outputFormat: 'text',
        timeout: DEBUG_INJECTION.SCRIPT_TIMEOUT_MS,
      }])
      await webviewProxy.evaluateScript(simpleScript)
      addLog('info', t('debug.waitingResult'))
    }
    catch (error) {
      addLog('error', `${t('debug.executionError')}: ${error}`)
    }
    finally {
      loading = false
    }
  }

  /**
   * 超级简单测试 - 只打印日志到子窗口 Console
   */
  async function testConsoleLog() {
    if (!webviewProxy) {
      addLog('error', t('debug.selectPlatformFirst'))
      return
    }

    try {
      loading = true
      addLog('info', t('debug.consoleTest'))

      // 1. 测试基础 console.log
      await webviewProxy.evaluateScript(`console.log('[ULTRA-SIMPLE-TEST] Hello from injection! Time:', Date.now());`)
      addLog('info', `${t('debug.consoleStep')}: ${t('debug.scriptDispatched')}`)

      // 等待 500ms
      await new Promise(resolve => setTimeout(resolve, DEBUG_INJECTION.CONSOLE_STEP_DELAY_MS))

      // 2. 测试修改 title
      await webviewProxy.evaluateScript(`
                console.log('[ULTRA-SIMPLE-TEST] Changing title...');
                document.title = '[TEST] Title changed at ' + Date.now();
            `)
      addLog('info', `${t('debug.titleStep')}: ${t('debug.scriptDispatched')}`)

      // 等待 500ms
      await new Promise(resolve => setTimeout(resolve, DEBUG_INJECTION.CONSOLE_STEP_DELAY_MS))

      // 3. 测试查找元素
      await webviewProxy.evaluateScript(`
                console.log('[ULTRA-SIMPLE-TEST] Looking for textarea...');
                const elem = document.querySelector('#prompt-textarea');
                console.log('[ULTRA-SIMPLE-TEST] Element found:', elem);
            `)
      addLog('info', `${t('debug.inputStep')}: ${t('debug.scriptDispatched')}`)

      addLog('info', t('debug.inspectConsole'))
    }
    catch (error) {
      addLog('error', `${t('debug.executionError')}: ${error}`)
    }
    finally {
      loading = false
    }
  }

  /**
   * 诊断脚本注入问题
   */
  async function diagnoseInjection() {
    if (!webviewProxy) {
      addLog('error', t('debug.initializeFirst'))
      return
    }

    try {
      loading = true
      addLog('info', t('debug.diagnose'))

      // 测试 1: 最简单的脚本（立即返回）
      addLog('info', t('debug.basicStep'))
      try {
        await webviewProxy.evaluateScript(`(function(){ return 'OK'; })();`)
        addLog('info', `${t('debug.basicStep')}: ${t('debug.scriptDispatched')}`)
      }
      catch (err) {
        addLog('error', `${t('debug.basicStep')}: ${err}`)
        addLog('error', t('debug.cspHint'))
        return // 后续测试没意义了
      }

      await new Promise(resolve => setTimeout(resolve, DEBUG_INJECTION.DIAGNOSTIC_STEP_DELAY_MS))

      // 测试 2: Console.log
      addLog('info', t('debug.consoleStep'))
      try {
        await webviewProxy.evaluateScript(`
                    (function(){
                        console.log('[DIAGNOSTIC] Test 2: Console works!');
                        console.error('[DIAGNOSTIC] Test 2: Error log works!');
                        console.warn('[DIAGNOSTIC] Test 2: Warn log works!');
                        return 'console-ok';
                    })();
                `)
        addLog('info', `${t('debug.consoleStep')}: ${t('debug.scriptDispatched')}`)
      }
      catch (err) {
        addLog('error', `${t('debug.consoleStep')}: ${err}`)
      }

      await new Promise(resolve => setTimeout(resolve, DEBUG_INJECTION.DIAGNOSTIC_STEP_DELAY_MS))

      // 测试 3: DOM 访问
      addLog('info', t('debug.domStep'))
      try {
        await webviewProxy.evaluateScript(`
                    (function(){
                        console.log('[DIAGNOSTIC] Test 3: URL =', window.location.href);
                        console.log('[DIAGNOSTIC] Test 3: Title =', document.title);
                        console.log('[DIAGNOSTIC] Test 3: Body exists =', !!document.body);
                        return 'dom-ok';
                    })();
                `)
        addLog('info', `${t('debug.domStep')}: ${t('debug.scriptDispatched')}`)
      }
      catch (err) {
        addLog('error', `${t('debug.domStep')}: ${err}`)
      }

      await new Promise(resolve => setTimeout(resolve, DEBUG_INJECTION.DIAGNOSTIC_STEP_DELAY_MS))

      // 测试 4: 查找 textarea
      addLog('info', t('debug.inputStep'))
      try {
        await webviewProxy.evaluateScript(`
                    (function(){
                        const selectors = [
                            'textarea[placeholder*="向千问提问"]',
                            'textarea[placeholder*="向千问"]',
                            'textarea[placeholder*="提问"]',
                            'textarea',
                            'div[contenteditable="true"]'
                        ];
                        
                        console.log('[DIAGNOSTIC] Test 4: Searching for input elements...');
                        for (const sel of selectors) {
                            const elem = document.querySelector(sel);
                            console.log('[DIAGNOSTIC] Test 4: Selector:', sel, '→', elem);
                            if (elem) {
                                console.log('[DIAGNOSTIC] Test 4: ✅ Found element with selector:', sel);
                                console.log('[DIAGNOSTIC] Test 4: Element details:', {
                                    tagName: elem.tagName,
                                    placeholder: elem.placeholder,
                                    className: elem.className,
                                    id: elem.id
                                });
                                break;
                            }
                        }
                        
                        const allTextareas = document.querySelectorAll('textarea');
                        console.log('[DIAGNOSTIC] Test 4: Total textareas found:', allTextareas.length);
                        allTextareas.forEach((ta, i) => {
                            console.log(\`[DIAGNOSTIC] Test 4: Textarea \${i+1}:\`, {
                                placeholder: ta.placeholder,
                                name: ta.name,
                                id: ta.id,
                                className: ta.className
                            });
                        });
                        
                        return 'search-ok';
                    })();
                `)
        addLog('info', `${t('debug.inputStep')}: ${t('debug.scriptDispatched')}`)
      }
      catch (err) {
        addLog('error', `${t('debug.inputStep')}: ${err}`)
      }

      await new Promise(resolve => setTimeout(resolve, DEBUG_INJECTION.DIAGNOSTIC_STEP_DELAY_MS))

      // 测试 5: 查找发送按钮
      addLog('info', t('debug.buttonStep'))
      try {
        await webviewProxy.evaluateScript(`
                    (function(){
                        console.log('[DIAGNOSTIC] Test 5: Searching for send button...');
                        
                        const buttonSelectors = [
                            '.operateBtn-JsB9e2',
                            'button[type="submit"]',
                            'button[aria-label*="发送"]',
                            '.send-button',
                            '.submit-button'
                        ];
                        
                        for (const sel of buttonSelectors) {
                            const btn = document.querySelector(sel);
                            console.log('[DIAGNOSTIC] Test 5: Button selector:', sel, '→', btn);
                            if (btn) {
                                console.log('[DIAGNOSTIC] Test 5: ✅ Found button:', {
                                    className: btn.className,
                                    textContent: btn.textContent,
                                    disabled: btn.disabled,
                                    offsetParent: btn.offsetParent !== null
                                });
                            }
                        }
                        
                        const allButtons = document.querySelectorAll('button');
                        console.log('[DIAGNOSTIC] Test 5: Total buttons found:', allButtons.length);
                        
                        return 'button-search-ok';
                    })();
                `)
        addLog('info', `${t('debug.buttonStep')}: ${t('debug.scriptDispatched')}`)
      }
      catch (err) {
        addLog('error', `${t('debug.buttonStep')}: ${err}`)
      }

      addLog('info', t('debug.inspectConsole'))
    }
    catch (error) {
      addLog('error', `${t('debug.executionError')}: ${error}`)
    }
    finally {
      loading = false
    }
  }

  /**
   * 执行注入
   */
  async function executeInjection() {
    if (!webviewProxy || !selectedPlatform || !message.trim()) {
      addLog('error', t('debug.fillAllFields'))
      return
    }

    try {
      loading = true
      result = null
      addLog('info', t('debug.executingInjection'))

      // Generate script from template
      const script = injectionManager.generateFromTemplate(
        selectedPlatform.id,
        DEBUG_INJECTION.SEND_TEMPLATE,
        message,
      )

      if (!script) {
        throw new Error(t('debug.templateNotFound'))
      }

      addLog('info', `${t('debug.generatedScript')}: ${script.length} ${t('debug.characters')}`)
      logger.info('Generated injection script', { scriptLength: script.length })

      // Execute injection
      const startTime = Date.now()
      await webviewProxy.evaluateScript(script)
      addLog('info', t('debug.waitingResult'))
      const duration = Date.now() - startTime
      logger.debug('Injection script dispatched', { durationMs: duration })
    // 结果将通过事件处理器 (CHILD_WEBVIEW_INJECTION_RESULT) 到达
    }
    catch (error) {
      addLog('error', `${t('debug.executionError')}: ${error}`)
      result = {
        success: false,
        error: String(error),
      }
    }
    finally {
      loading = false
    }
  }

  /**
   * 开始监听 AI 回复
   */
    /**
     * 测试单步执行 - 只填充
     */
  async function testFillOnly() {
    if (!webviewProxy || !message.trim()) {
      addLog('error', t('debug.fillAllFields'))
      return
    }

    try {
      loading = true
      addLog('info', t('debug.testFill'))

      const script = injectionManager.generateFill(DEBUG_INJECTION.INPUT_SELECTOR, message, true, DEBUG_INJECTION.SCRIPT_TIMEOUT_MS)
      addLog('info', `${t('debug.generatedScript')}: ${script.length}`)

      await webviewProxy.evaluateScript(script)
      addLog('info', t('debug.scriptDispatched'))
    }
    catch (error) {
      addLog('error', `${t('debug.executionError')}: ${error}`)
    }
    finally {
      loading = false
    }
  }

  /**
   * 测试单步执行 - 只点击
   */
  async function testClickOnly() {
    if (!webviewProxy) {
      addLog('error', t('debug.initializeFirst'))
      return
    }

    try {
      loading = true
      addLog('info', t('debug.testClick'))

      const script = injectionManager.generateClick(DEBUG_INJECTION.SEND_SELECTOR, DEBUG_INJECTION.SCRIPT_TIMEOUT_MS)
      addLog('info', `${t('debug.generatedScript')}: ${script.length}`)

      await webviewProxy.evaluateScript(script)
      addLog('info', t('debug.scriptDispatched'))
    }
    catch (error) {
      addLog('error', `${t('debug.executionError')}: ${error}`)
    }
    finally {
      loading = false
    }
  }

  /**
   * 提取 AI 回复内容
   */
  async function extractResponse() {
    if (!webviewProxy || !selectedPlatform) {
      addLog('error', t('debug.initializeFirst'))
      return
    }

    try {
      loading = true
      addLog('info', t('debug.extractReply'))

      result = null
      extractedContent = ''
      const extractScript = generateInjectionScript([{
        type: 'extract',
        extractScript: `() => {
          const paragraphs = document.querySelectorAll('div[data-message-author-role="assistant"] p');
          return paragraphs[paragraphs.length - 1]?.textContent?.trim() || '';
        }`,
        outputFormat: 'text',
        timeout: DEBUG_INJECTION.SCRIPT_TIMEOUT_MS,
      }])
      await webviewProxy.evaluateScript(extractScript)
      addLog('info', t('debug.waitingResult'))
    }
    catch (error) {
      addLog('error', `${t('debug.executionError')}: ${error}`)
    }
    finally {
      loading = false
    }
  }

  /**
   * 返回设置页面
   */
  function goBack() {
    // 如果正在显示 webview，先隐藏它
    if (showWebview) {
      hideWebview()
      return
    }

    // 自动清理 webview
    if (webviewProxy) {
      webviewProxy.close().catch((err) => {
        logger.error('Failed to close debug webview on back', err)
      })
      webviewProxy = null
    }
    appState.openSettings()
  }
</script>

<div class='debug-page' class:webview-mode={showWebview}>
  {#if showWebview}
    <!-- WebView 模式 - 显示浮动控制栏 -->
    <div class='floating-controls'>
      <button class='control-btn' onclick={goBack} title={t('common.back')}>
        <svg fill='none' stroke='currentColor' viewBox='0 0 24 24'>
          <path
            stroke-linecap='round'
            stroke-linejoin='round'
            stroke-width='2'
            d='M15 19l-7-7 7-7'
          />
        </svg>
        {t('common.back')}
      </button>

      <div class='control-divider'></div>

      <button class='control-btn' onclick={testSimpleScript} disabled={loading} title={t('debug.testScript')}>
        🧪 {t('debug.testScript')}
      </button>

      <button class='control-btn' onclick={diagnoseInjection} disabled={loading} title={t('debug.diagnose')}>
        🔍 {t('debug.diagnose')}
      </button>

      <input
        type='text'
        bind:value={message}
        placeholder={t('debug.messagePlaceholder')}
        class='floating-input'
        disabled={loading}
      />

      <button
        class='control-btn primary'
        onclick={executeInjection}
        disabled={loading || !message.trim()}
      >
        {loading ? t('debug.executing') : t('debug.executeInjection')}
      </button>

      <button class='control-btn danger' onclick={closeWebview} disabled={loading}>
        {t('debug.closeWebview')}
      </button>
    </div>
  {:else}
    <!-- 控制面板模式 -->
    <div class='debug-header'>
      <button class='back-btn' onclick={goBack}>
        <svg fill='none' stroke='currentColor' viewBox='0 0 24 24'>
          <path
            stroke-linecap='round'
            stroke-linejoin='round'
            stroke-width='2'
            d='M15 19l-7-7 7-7'
          />
        </svg>
        {t('common.back')}
      </button>
      <h2>{t('debug.title')}</h2>
    </div>

    <!-- 控制面板 -->
    <div class='control-panel'>
      <div class='control-section'>
        <label for='platform-select'>
          {t('debug.selectPlatform')}:
        </label>
        <select
          id='platform-select'
          bind:value={selectedPlatform}
          disabled={loading}
          onchange={changePlatform}
        >
          <option value={null}>{t('debug.pleaseSelect')}</option>
          {#each BUILT_IN_AI_PLATFORMS as platform (platform.id)}
            <option value={platform}>{platform.name}</option>
          {/each}
        </select>
      </div>

      <div class='control-actions'>
        {#if !webviewProxy}
          <button class='btn btn-primary' onclick={initializeWebview} disabled={loading || !selectedPlatform}>
            {loading ? t('debug.initializing') : t('debug.initWebview')}
          </button>
        {:else}
          <button class='btn btn-accent' onclick={testConsoleLog} disabled={loading}>
            {t('debug.consoleTest')}
          </button>
          <button class='btn btn-accent' onclick={testSimpleScript} disabled={loading}>
            {t('debug.testScript')}
          </button>
          <button class='btn btn-accent' onclick={showWebviewAgain} disabled={loading}>
            {t('debug.showWebview')}
          </button>
          <button class='btn btn-secondary' onclick={closeWebview} disabled={loading}>
            {t('debug.closeWebview')}
          </button>
        {/if}
      </div>
    </div>

    <!-- 注入控制 -->
    {#if webviewProxy}
      <div class='injection-panel'>
        <label for='message-input'>
          {t('debug.messageToInject')}:
        </label>
        <textarea
          id='message-input'
          bind:value={message}
          placeholder={t('debug.messagePlaceholder')}
          rows='4'
          disabled={loading}
        ></textarea>

        <button class='btn btn-accent' onclick={executeInjection} disabled={loading || !message.trim()}>
          {loading ? t('debug.executing') : t('debug.executeInjection')}
        </button>

        <!-- 测试按钮 -->
        <div class='test-buttons'>
          <button class='btn btn-secondary' onclick={diagnoseInjection} disabled={loading}>
            {t('debug.diagnose')}
          </button>
          <button class='btn btn-secondary' onclick={testFillOnly} disabled={loading || !message.trim()}>
            {t('debug.testFill')}
          </button>
          <button class='btn btn-secondary' onclick={testClickOnly} disabled={loading}>
            {t('debug.testClick')}
          </button>
          <button class='btn btn-info' onclick={extractResponse} disabled={loading}>
            {t('debug.extractReply')}
          </button>
        </div>

        <!-- 显示提取的内容 -->
        {#if extractedContent}
          <div class='extracted-content'>
            <h4>{t('debug.extracted')}</h4>
            <pre>{extractedContent}</pre>
          </div>
        {/if}
      </div>
    {/if}

    <!-- 结果显示 -->
    {#if result}
      <div class='result-panel' class:success={result.success} class:error={!result.success}>
        <h3>
          {result.success ? `✓ ${t('debug.success')}` : `✗ ${t('debug.failed')}`}
        </h3>
        {#if result.success}
          <p>{t('debug.actionsExecuted')}: {result.actionsExecuted}</p>
          <p>{t('debug.duration')}: {result.duration}ms</p>
        {:else}
          <p>{t('debug.error')}: {result.error}</p>
        {/if}
      </div>
    {/if}

    <!-- 日志面板 -->
    <div class='logs-panel'>
      <div class='logs-header'>
        <h3>{t('debug.logs')}</h3>
        <button class='btn-small' onclick={clearLogs}>{t('debug.clearLogs')}</button>
      </div>
      <div class='logs-content'>
        {#each logs as log, index (index)}
          <div class='log-entry log-{log.type}'>
            <span class='log-time'>{log.time}</span>
            <span class='log-type'>[{log.type.toUpperCase()}]</span>
            <span class='log-message'>{log.message}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
    .test-buttons {
        margin-top: 1rem;
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .debug-page {
        width: 100%;
        max-width: 1000px;
        margin: 0 auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .debug-page.webview-mode {
        /* In webview mode, remove constraints to let child webview fill the space */
        max-width: none;
        width: 100%;
        height: 100vh;
        padding: 0;
        margin: 0;
        gap: 0;
        overflow: hidden;
    }

    .debug-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--border-color);
    }

    .back-btn {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.5rem 1rem;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        color: var(--text-primary);
        cursor: pointer;
        transition: all 0.2s;
    }

    .back-btn:hover {
        background: var(--bg-tertiary);
    }

    .back-btn svg {
        width: 20px;
        height: 20px;
    }

    h2 {
        margin: 0;
        color: var(--text-primary);
        font-size: 1.5rem;
    }

    .control-panel {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .control-section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    label {
        color: var(--text-primary);
        font-weight: 500;
        font-size: 0.9rem;
    }

    select,
    textarea {
        padding: 0.625rem;
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: inherit;
        font-size: 0.9rem;
    }

    select:disabled,
    textarea:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    textarea {
        resize: vertical;
        min-height: 80px;
    }

    .control-actions {
        display: flex;
        gap: 0.5rem;
    }

    .injection-panel {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .btn {
        padding: 0.625rem 1.25rem;
        border: none;
        border-radius: 0.5rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 0.9rem;
    }

    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .btn-primary {
        background: var(--accent-color);
        color: var(--text-on-accent);
    }

    .btn-primary:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .btn-secondary {
        background: var(--bg-tertiary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
    }

    .btn-secondary:hover:not(:disabled) {
        background: var(--bg-primary);
    }

    .btn-accent {
        background: var(--accent-color);
        color: var(--text-on-accent);
    }

    .btn-accent:hover:not(:disabled) {
        opacity: 0.9;
        transform: translateY(-1px);
    }

    .result-panel {
        padding: 1rem;
        border-radius: 0.5rem;
        border: 2px solid;
    }

    .result-panel.success {
        background: color-mix(in srgb, var(--success-color) 10%, transparent);
        border-color: color-mix(in srgb, var(--success-color) 30%, transparent);
    }

    .result-panel.error {
        background: color-mix(in srgb, var(--error-color) 10%, transparent);
        border-color: color-mix(in srgb, var(--error-color) 30%, transparent);
    }

    .result-panel h3 {
        margin: 0 0 0.5rem;
        color: var(--text-primary);
    }

    .result-panel p {
        margin: 0.25rem 0;
        color: var(--text-secondary);
        font-size: 0.9rem;
    }

    .logs-panel {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        padding: 1rem;
        max-height: 400px;
        min-height: 200px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .logs-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border-color);
    }

    .logs-header h3 {
        margin: 0;
        color: var(--text-primary);
        font-size: 1rem;
    }

    .btn-small {
        padding: 0.375rem 0.75rem;
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        color: var(--text-primary);
        cursor: pointer;
        font-size: 0.8rem;
        transition: all 0.2s;
    }

    .btn-small:hover {
        background: var(--bg-tertiary);
    }

    .logs-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 0.85rem;
        min-height: 0; /* 确保 flex 子元素可以滚动 */
    }

    .logs-content::-webkit-scrollbar {
        width: 8px;
    }

    .logs-content::-webkit-scrollbar-track {
        background: var(--bg-primary);
        border-radius: 4px;
    }

    .logs-content::-webkit-scrollbar-thumb {
        background: var(--border-color);
        border-radius: 4px;
    }

    .logs-content::-webkit-scrollbar-thumb:hover {
        background: var(--text-tertiary);
    }

    .log-entry {
        padding: 0.375rem 0.5rem;
        display: flex;
        gap: 0.5rem;
        border-bottom: 1px solid var(--border-color);
    }

    .log-entry:last-child {
        border-bottom: none;
    }

    .log-time {
        color: var(--text-tertiary);
        min-width: 80px;
    }

    .log-type {
        font-weight: 600;
        min-width: 70px;
    }

    .log-info .log-type {
        color: var(--accent-color);
    }

    .log-success .log-type {
        color: var(--success-color);
    }

    .log-error .log-type {
        color: var(--error-color);
    }

    .log-message {
        color: var(--text-primary);
        flex: 1;
    }

    /* 浮动控制栏样式 */
    .floating-controls {
        position: fixed;
        top: 60px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--bg-primary);
        backdrop-filter: blur(10px);
        border: 1px solid var(--bg-secondary);
        border-radius: 0.75rem;
        box-shadow: var(--shadow-modal);
    }

    .control-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 1rem;
        border: 1px solid var(--bg-tertiary);
        border-radius: 0.5rem;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .control-btn:hover:not(:disabled) {
        background: var(--bg-tertiary);
        border-color: var(--border-color);
    }

    .control-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .control-btn svg {
        width: 18px;
        height: 18px;
    }

    .control-btn.primary {
        background: var(--accent-color);
        border-color: var(--accent-color);
    }

    .control-btn.primary:hover:not(:disabled) {
        opacity: 0.9;
    }

    .control-btn.danger {
        background: var(--error-color);
        border-color: var(--error-color);
    }

    .control-btn.danger:hover:not(:disabled) {
        background: var(--error-color);
    }

    .control-divider {
        width: 1px;
        height: 24px;
        background: var(--bg-tertiary);
        margin: 0 0.25rem;
    }

    .floating-input {
        flex: 1;
        min-width: 300px;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--bg-tertiary);
        border-radius: 0.5rem;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 0.875rem;
    }

    .floating-input::placeholder {
        color: var(--text-secondary);
    }

    .floating-input:focus {
        outline: none;
        border-color: var(--accent-color);
        background: var(--bg-tertiary);
    }

    .floating-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* 提取控制样式 */
    .extract-section {
        margin-top: 0.5rem;
    }

    .btn-info {
        background-color: var(--accent-color);
        color: var(--text-on-accent);
    }

    .btn-info:hover:not(:disabled) {
        background-color: var(--accent-hover);
    }

    /* 提取内容显示 */
    .extracted-content {
        margin-top: 0.75rem;
        padding: 1rem;
        background: var(--bg-tertiary);
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
    }

    .extracted-content h4 {
        margin: 0 0 0.75rem 0;
        font-size: 0.875rem;
        color: var(--text-primary);
        font-weight: 600;
    }

    .extracted-content pre {
        margin: 0;
        padding: 0.75rem;
        background: var(--bg-primary);
        border-radius: 0.375rem;
        font-size: 0.8rem;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 400px;
        overflow-y: auto;
        color: var(--text-secondary);
        font-family: 'Consolas', 'Monaco', monospace;
    }
</style>

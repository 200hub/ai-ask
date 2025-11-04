<script lang="ts">
	/**
	 * 注入调试页面 - 测试 WebView 自动注入功能
	 */
	import { onMount, onDestroy } from 'svelte';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { ChildWebviewProxy, calculateChildWebviewBounds } from '$lib/utils/childWebview';
	import { injectionManager } from '$lib/utils/injection';
	import { ALL_TEMPLATES } from '$lib/utils/injection-templates';
	import { BUILT_IN_AI_PLATFORMS, EVENTS, DEBUG_FLOATING_CONTROLS_OFFSET } from '$lib/utils/constants';
	import { logger } from '$lib/utils/logger';
	import { i18n } from '$lib/i18n';
	import { appState } from '$lib/stores/app.svelte';
	import { responseMonitor } from '$lib/stores/response-monitor.svelte';
	import type { InjectionResult } from '$lib/types/injection';
	import type { AIPlatform } from '$lib/types/platform';

	const t = i18n.t;

	let webviewProxy = $state<ChildWebviewProxy | null>(null);
	let selectedPlatform = $state<AIPlatform | null>(null);
	let message = $state('');
	let loading = $state(false);
	let result = $state<InjectionResult | null>(null);
	let logs = $state<Array<{ time: string; type: string; message: string }>>([]);
	let showWebview = $state(false); // 是否显示 webview（隐藏控制面板）
	let shouldRestoreWebview = false; // 是否在恢复事件后重新显示 webview
	let isMonitoringResponse = $state(false); // 是否正在监听回复
	let lastAIResponse = $state<string>(''); // 最后接收到的 AI 回复

	// Debug: track showWebview changes
	$effect(() => {
		logger.info('[DEBUG] showWebview changed:', showWebview);
	});

	function handleHideAllWebviewsEvent(event: Event) {
		const customEvent = event as CustomEvent<{ markForRestore?: boolean }>;
		const markForRestore = customEvent.detail?.markForRestore ?? true;

		shouldRestoreWebview = Boolean(markForRestore && webviewProxy && showWebview);

		if (webviewProxy) {
			webviewProxy.hide().catch((err) => {
				logger.error('Failed to hide debug webview via event', err);
			});
		}

		showWebview = false;
	}

	function handleRestoreWebviewsEvent() {
		if (!shouldRestoreWebview || !webviewProxy) {
			return;
		}

		shouldRestoreWebview = false;
		void showWebviewAgain();
	}

	// 注册所有内置模板
	onMount(() => {
		ALL_TEMPLATES.forEach((template) => {
			injectionManager.registerTemplate(template);
		});
		addLog('info', t('debug.initialized'));

		window.addEventListener(EVENTS.HIDE_ALL_WEBVIEWS, handleHideAllWebviewsEvent as EventListener);
		window.addEventListener(EVENTS.RESTORE_WEBVIEWS, handleRestoreWebviewsEvent as EventListener);

		return () => {
			window.removeEventListener(
				EVENTS.HIDE_ALL_WEBVIEWS,
				handleHideAllWebviewsEvent as EventListener
			);
			window.removeEventListener(
				EVENTS.RESTORE_WEBVIEWS,
				handleRestoreWebviewsEvent as EventListener
			);
		};
	});

	onDestroy(() => {
		// 停止所有监听
		responseMonitor.stopAll();
		
		if (webviewProxy) {
			webviewProxy.close().catch((err) => {
				logger.error('Failed to close webview', err);
			});
		}
	});

	/**
	 * 添加日志
	 */
	function addLog(type: string, message: string) {
		const time = new Date().toLocaleTimeString();
		logs = [...logs, { time, type, message }];
	}

	/**
	 * 清空日志
	 */
	function clearLogs() {
		logs = [];
	}

	/**
	 * 初始化 WebView
	 */
	async function initializeWebview() {
		if (!selectedPlatform) {
			addLog('error', t('debug.selectPlatformFirst'));
			return;
		}

		try {
			loading = true;
			result = null;
			addLog('info', `${t('debug.initializing')} ${selectedPlatform.name}...`);

			// 切换到 webview 显示模式
			showWebview = true;

			// 等待 DOM 更新后再计算 bounds
			await new Promise(resolve => setTimeout(resolve, 100));

			const mainWindow = getCurrentWebviewWindow();
			const bounds = await calculateChildWebviewBounds(mainWindow);
			// Reserve space at the top for floating controls bar
			bounds.positionLogical.y += DEBUG_FLOATING_CONTROLS_OFFSET;
			bounds.sizeLogical.height = Math.max(0, bounds.sizeLogical.height - DEBUG_FLOATING_CONTROLS_OFFSET);

			// 创建并初始化 webview - 使用 debug- 前缀避免与正常平台冲突
			const debugWebviewId = `debug-${selectedPlatform.id}`;
			webviewProxy = new ChildWebviewProxy(debugWebviewId, selectedPlatform.url, null);
			await webviewProxy.ensure(bounds);
			await webviewProxy.show();

			addLog('info', t('debug.webviewCreated'));

			// 等待页面加载
			addLog('info', t('debug.waitingForPage'));
			await webviewProxy.waitForLoadFinished(15000);

			addLog('success', t('debug.pageLoaded'));
		} catch (error) {
			addLog('error', `${t('debug.initFailed')}: ${error}`);
			result = {
				success: false,
				error: String(error)
			};
			showWebview = false; // 失败时回到控制面板
		} finally {
			loading = false;
		}
	}

	/**
	 * 隐藏 WebView，回到控制面板
	 */
	function hideWebview() {
		shouldRestoreWebview = false;
		showWebview = false;
		if (webviewProxy) {
			webviewProxy.hide().catch((err) => {
				logger.error('Failed to hide webview', err);
			});
		}
	}

	/**
	 * 显示 WebView
	 */
	async function showWebviewAgain() {
		if (!webviewProxy) return;
		
		try {
			showWebview = true;
			await new Promise(resolve => setTimeout(resolve, 100));
			
			const mainWindow = getCurrentWebviewWindow();
			const bounds = await calculateChildWebviewBounds(mainWindow);
			// Reserve space at the top for floating controls bar
			bounds.positionLogical.y += DEBUG_FLOATING_CONTROLS_OFFSET;
			bounds.sizeLogical.height = Math.max(0, bounds.sizeLogical.height - DEBUG_FLOATING_CONTROLS_OFFSET);
			await webviewProxy.updateBounds(bounds);
			await webviewProxy.show();
		} catch (error) {
			logger.error('Failed to show webview', error);
			showWebview = false;
		}
	}

	/**
	 * 关闭 WebView
	 */
	async function closeWebview() {
		if (!webviewProxy) return;

		try {
			addLog('info', t('debug.closingWebview'));
			await webviewProxy.close();
			webviewProxy = null;
			showWebview = false;
			shouldRestoreWebview = false;
			addLog('success', t('debug.webviewClosed'));
		} catch (error) {
			addLog('error', `${t('debug.closeFailed')}: ${error}`);
		}
	}

	/**
	 * 测试简单脚本执行
	 */
	async function testSimpleScript() {
		if (!webviewProxy) {
			addLog('error', t('debug.selectPlatformFirst'));
			return;
		}

		try {
			loading = true;
			addLog('info', 'Testing simple script execution...');

			// 测试最简单的脚本
			const simpleScript = `
				console.log('[TEST] Simple test script running');
				return { test: 'success', timestamp: Date.now() };
			`;

			const testResult = await webviewProxy.evaluateScript<{
				test: string;
				timestamp: number;
			}>(simpleScript, 5000);

			addLog('success', `Simple test passed: ${JSON.stringify(testResult)}`);
		} catch (error) {
			addLog('error', `Simple test failed: ${error}`);
		} finally {
			loading = false;
		}
	}

	/**
	 * 超级简单测试 - 只打印日志到子窗口 Console
	 */
	async function testConsoleLog() {
		if (!webviewProxy) {
			addLog('error', t('debug.selectPlatformFirst'));
			return;
		}

		try {
			loading = true;
			addLog('info', '开始测试 Console 输出...');

			// 1. 测试基础 console.log
			await webviewProxy.evaluateScript(`console.log('[ULTRA-SIMPLE-TEST] Hello from injection! Time:', Date.now());`, 3000);
			addLog('success', '✅ Test 1: Basic console.log sent');

			// 等待 500ms
			await new Promise(resolve => setTimeout(resolve, 500));

			// 2. 测试修改 title
			await webviewProxy.evaluateScript(`
				console.log('[ULTRA-SIMPLE-TEST] Changing title...');
				document.title = '[TEST] Title changed at ' + Date.now();
			`, 3000);
			addLog('success', '✅ Test 2: Title change sent');

			// 等待 500ms
			await new Promise(resolve => setTimeout(resolve, 500));

			// 3. 测试查找元素
			await webviewProxy.evaluateScript(`
				console.log('[ULTRA-SIMPLE-TEST] Looking for textarea...');
				const elem = document.querySelector('#prompt-textarea');
				console.log('[ULTRA-SIMPLE-TEST] Element found:', elem);
			`, 3000);
			addLog('success', '✅ Test 3: Element search sent');

			addLog('success', '🎉 所有测试已发送！请检查子窗口的 Console 和 Title');
		} catch (error) {
			addLog('error', `❌ 测试失败: ${error}`);
		} finally {
			loading = false;
		}
	}

	/**
	 * 执行注入
	 */
	async function executeInjection() {
		if (!webviewProxy || !selectedPlatform || !message.trim()) {
			addLog('error', t('debug.fillAllFields'));
			return;
		}

		try {
			loading = true;
			result = null;
			addLog('info', t('debug.executingInjection'));

			// 查找模板
			const template = injectionManager.findTemplateForUrl(
				selectedPlatform.url,
				selectedPlatform.id
			);

			if (!template) {
				throw new Error(t('debug.templateNotFound'));
			}

			addLog('info', `${t('debug.foundTemplate')}: ${template.name}`);

			// 克隆模板并自定义内容
			const customTemplate = JSON.parse(JSON.stringify(template));
			if (customTemplate.actions[0]?.type === 'fill') {
				customTemplate.actions[0].content = message;
			}

			// 生成脚本
			const script = injectionManager.generateTemplateScript(customTemplate);
			addLog('info', `${t('debug.generatedScript')}: ${script.length} ${t('debug.characters')}`);
			
			// Debug: log the generated script to console
			logger.info('Generated injection script:', script);

			// 执行注入
			const startTime = Date.now();
			const rawResult = await webviewProxy.evaluateScript<InjectionResult>(script);
			const duration = Date.now() - startTime;

			result = injectionManager.parseResult(rawResult);
			logger.info('Injection result received', { rawResult });

			if (result.success) {
				addLog(
					'success',
					`${t('debug.injectionSuccess')} (${duration}ms, ${result.actionsExecuted} ${t('debug.actions')})`
				);
				message = ''; // 清空输入
			} else {
				addLog('error', `${t('debug.injectionFailed')}: ${result.error}`);
			}
		} catch (error) {
			addLog('error', `${t('debug.executionError')}: ${error}`);
			result = {
				success: false,
				error: String(error)
			};
		} finally {
			loading = false;
		}
	}

	/**
	 * 开始监听 AI 回复
	 */
	async function startMonitoringResponse() {
		if (!webviewProxy || !selectedPlatform) {
			addLog('error', '请先初始化 WebView 并选择平台');
			return;
		}

		const responseSelector = 'div[data-message-author-role="assistant"]'; // ChatGPT 回复选择器

		try {
			isMonitoringResponse = true;
			addLog('info', `开始监听 ${selectedPlatform.name} 的回复...`);

			await responseMonitor.startMonitoring(
				selectedPlatform.id,
				webviewProxy.id,
				responseSelector,
				1000, // 每秒轮询一次
				(response) => {
					// 收到新回复时的回调
					lastAIResponse = response.content;
					addLog('success', `📩 收到回复 (${response.content.length} 字符, ${response.isComplete ? '✅ 完成' : '⏳ 进行中'})`);
				}
			);

			addLog('success', '✅ 监听已启动，等待 AI 回复...');
		} catch (error) {
			addLog('error', `启动监听失败: ${error}`);
			isMonitoringResponse = false;
		}
	}

	/**
	 * 停止监听 AI 回复
	 */
	function stopMonitoringResponse() {
		if (!selectedPlatform || !webviewProxy) return;

		responseMonitor.stopMonitoring(selectedPlatform.id, webviewProxy.id);
		isMonitoringResponse = false;
		addLog('info', '🛑 已停止监听回复');
	}

	/**
	 * 返回设置页面
	 */
	function goBack() {
		// 停止监听
		if (isMonitoringResponse) {
			stopMonitoringResponse();
		}
		
		// 如果正在显示 webview，先隐藏它
		if (showWebview) {
			hideWebview();
			return;
		}
		
		// 自动清理 webview
		if (webviewProxy) {
			webviewProxy.close().catch((err) => {
				logger.error('Failed to close debug webview on back', err);
			});
			webviewProxy = null;
		}
		appState.openSettings();
	}
</script>

<div class="debug-page" class:webview-mode={showWebview}>
	{#if showWebview}
		<!-- WebView 模式 - 显示浮动控制栏 -->
		<div class="floating-controls">
			<button class="control-btn" onclick={goBack} title={t('common.back')}>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 19l-7-7 7-7"
					/>
				</svg>
				{t('common.back')}
			</button>

			<div class="control-divider"></div>

			<button class="control-btn" onclick={testSimpleScript} disabled={loading} title="Test Script">
				🧪 Test
			</button>

			<input
				type="text"
				bind:value={message}
				placeholder={t('debug.messagePlaceholder')}
				class="floating-input"
				disabled={loading}
			/>

			<button
				class="control-btn primary"
				onclick={executeInjection}
				disabled={loading || !message.trim()}
			>
				{loading ? t('debug.executing') : t('debug.executeInjection')}
			</button>

			<button class="control-btn danger" onclick={closeWebview}>
				{t('debug.closeWebview')}
			</button>
		</div>
	{:else}
		<!-- 控制面板模式 -->
		<div class="debug-header">
			<button class="back-btn" onclick={goBack}>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 19l-7-7 7-7"
					/>
				</svg>
				{t('common.back')}
			</button>
			<h2>{t('debug.title')}</h2>
		</div>

			<!-- 控制面板 -->
		<div class="control-panel">
			<div class="control-section">
				<label for="platform-select">
					{t('debug.selectPlatform')}:
				</label>
				<select
					id="platform-select"
					bind:value={selectedPlatform}
					disabled={loading || webviewProxy !== null}
				>
					<option value={null}>{t('debug.pleaseSelect')}</option>
					{#each BUILT_IN_AI_PLATFORMS as platform}
						<option value={platform}>{platform.name}</option>
					{/each}
				</select>
			</div>

			<div class="control-actions">
				{#if !webviewProxy}
					<button class="btn btn-primary" onclick={initializeWebview} disabled={loading || !selectedPlatform}>
						{loading ? t('debug.initializing') : t('debug.initWebview')}
					</button>
				{:else}
					<button class="btn btn-accent" onclick={testConsoleLog} disabled={loading}>
						🔍 Ultra-Simple Test
					</button>
					<button class="btn btn-accent" onclick={testSimpleScript} disabled={loading}>
						Test Simple Script
					</button>
					<button class="btn btn-accent" onclick={showWebviewAgain} disabled={loading}>
						{t('debug.showWebview')}
					</button>
					<button class="btn btn-secondary" onclick={closeWebview} disabled={loading}>
						{t('debug.closeWebview')}
					</button>
				{/if}
			</div>
		</div>

		<!-- 注入控制 -->
		{#if webviewProxy}
			<div class="injection-panel">
				<label for="message-input">
					{t('debug.messageToInject')}:
				</label>
				<textarea
					id="message-input"
					bind:value={message}
					placeholder={t('debug.messagePlaceholder')}
					rows="4"
					disabled={loading}
				></textarea>

				<button class="btn btn-accent" onclick={executeInjection} disabled={loading || !message.trim()}>
					{loading ? t('debug.executing') : t('debug.executeInjection')}
				</button>

				<!-- 监听 AI 回复控制 -->
				<div class="monitor-section">
					<div class="monitor-label">AI 回复监听:</div>
					<div class="monitor-controls">
						{#if !isMonitoringResponse}
							<button class="btn btn-success" onclick={startMonitoringResponse} disabled={loading}>
								🎧 开始监听回复
							</button>
						{:else}
							<button class="btn btn-warning" onclick={stopMonitoringResponse}>
								🛑 停止监听
							</button>
						{/if}
					</div>
				</div>

				<!-- 显示最后一次回复 -->
				{#if lastAIResponse}
					<div class="ai-response">
						<h4>📝 最后收到的 AI 回复:</h4>
						<pre>{lastAIResponse}</pre>
					</div>
				{/if}
			</div>
		{/if}

		<!-- 结果显示 -->
		{#if result}
			<div class="result-panel" class:success={result.success} class:error={!result.success}>
				<h3>
					{result.success ? '✓ ' + t('debug.success') : '✗ ' + t('debug.failed')}
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
		<div class="logs-panel">
			<div class="logs-header">
				<h3>{t('debug.logs')}</h3>
				<button class="btn-small" onclick={clearLogs}>{t('debug.clearLogs')}</button>
			</div>
			<div class="logs-content">
				{#each logs as log}
					<div class="log-entry log-{log.type}">
						<span class="log-time">{log.time}</span>
						<span class="log-type">[{log.type.toUpperCase()}]</span>
						<span class="log-message">{log.message}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
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
		color: white;
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
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
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
		background: rgba(0, 200, 0, 0.1);
		border-color: rgba(0, 200, 0, 0.3);
	}

	.result-panel.error {
		background: rgba(200, 0, 0, 0.1);
		border-color: rgba(200, 0, 0, 0.3);
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
		color: #3b82f6;
	}

	.log-success .log-type {
		color: #10b981;
	}

	.log-error .log-type {
		color: #ef4444;
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
		background: rgba(0, 0, 0, 0.85);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.75rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
	}

	.control-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.1);
		color: white;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.control-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.2);
		border-color: rgba(255, 255, 255, 0.3);
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
		background: rgba(239, 68, 68, 0.8);
		border-color: rgba(239, 68, 68, 0.8);
	}

	.control-btn.danger:hover:not(:disabled) {
		background: rgba(239, 68, 68, 1);
	}

	.control-divider {
		width: 1px;
		height: 24px;
		background: rgba(255, 255, 255, 0.2);
		margin: 0 0.25rem;
	}

	.floating-input {
		flex: 1;
		min-width: 300px;
		padding: 0.5rem 0.75rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.1);
		color: white;
		font-size: 0.875rem;
	}

	.floating-input::placeholder {
		color: rgba(255, 255, 255, 0.5);
	}

	.floating-input:focus {
		outline: none;
		border-color: var(--accent-color);
		background: rgba(255, 255, 255, 0.15);
	}

	.floating-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* 监听控制样式 */
	.monitor-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-color);
	}

	.monitor-label {
		color: var(--text-primary);
		font-weight: 500;
		font-size: 0.9rem;
	}

	.monitor-controls {
		display: flex;
		gap: 0.5rem;
	}

	.btn-success {
		background-color: #10b981;
		color: white;
	}

	.btn-success:hover:not(:disabled) {
		background-color: #059669;
	}

	.btn-warning {
		background-color: #f59e0b;
		color: white;
	}

	.btn-warning:hover:not(:disabled) {
		background-color: #d97706;
	}

	/* AI 回复显示 */
	.ai-response {
		margin-top: 0.75rem;
		padding: 1rem;
		background: var(--bg-tertiary);
		border-radius: 0.5rem;
		border: 1px solid var(--border-color);
	}

	.ai-response h4 {
		margin: 0 0 0.75rem 0;
		font-size: 0.875rem;
		color: var(--text-primary);
		font-weight: 600;
	}

	.ai-response pre {
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

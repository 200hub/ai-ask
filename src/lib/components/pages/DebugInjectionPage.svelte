<script lang="ts">
	/**
	 * 注入调试页面 - 测试 WebView 自动注入功能
	 */
	import { onMount, onDestroy } from 'svelte';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { ChildWebviewProxy, calculateChildWebviewBounds } from '$lib/utils/childWebview';
	import { injectionManager } from '$lib/utils/injection';
	import { ALL_TEMPLATES } from '$lib/utils/injection-templates';
	import { BUILT_IN_AI_PLATFORMS } from '$lib/utils/constants';
	import { logger } from '$lib/utils/logger';
	import { i18n } from '$lib/i18n';
	import { appState } from '$lib/stores/app.svelte';
	import type { InjectionResult } from '$lib/types/injection';
	import type { AIPlatform } from '$lib/types/platform';

	const t = i18n.t;

	let webviewProxy = $state<ChildWebviewProxy | null>(null);
	let selectedPlatform = $state<AIPlatform | null>(null);
	let message = $state('');
	let loading = $state(false);
	let result = $state<InjectionResult | null>(null);
	let logs = $state<Array<{ time: string; type: string; message: string }>>([]);

	// 注册所有内置模板
	onMount(() => {
		ALL_TEMPLATES.forEach((template) => {
			injectionManager.registerTemplate(template);
		});
		addLog('info', t('debug.initialized'));
	});

	onDestroy(() => {
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

			const mainWindow = getCurrentWebviewWindow();
			const bounds = await calculateChildWebviewBounds(mainWindow);

			// 创建并初始化 webview
			webviewProxy = new ChildWebviewProxy(selectedPlatform.id, selectedPlatform.url, null);
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
		} finally {
			loading = false;
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
			addLog('success', t('debug.webviewClosed'));
		} catch (error) {
			addLog('error', `${t('debug.closeFailed')}: ${error}`);
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

			// 执行注入
			const startTime = Date.now();
			const rawResult = await webviewProxy.evaluateScript<InjectionResult>(script);
			const duration = Date.now() - startTime;

			result = injectionManager.parseResult(rawResult);

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
	 * 返回设置页面
	 */
	function goBack() {
		if (webviewProxy) {
			webviewProxy.close().catch((err) => {
				logger.error('Failed to close webview on go back', err);
			});
		}
		appState.openSettings();
	}
</script>

<div class="debug-page">
	<!-- 头部 -->
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
		display: flex;
		flex-direction: column;
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
		font-family: 'Consolas', 'Monaco', monospace;
		font-size: 0.85rem;
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
</style>

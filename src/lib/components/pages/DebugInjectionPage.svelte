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
	let extractedContent = $state<string>(''); // 提取的内容

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

	let unlistenInjectionResult: (() => void) | null = null;

	// 注册所有内置模板
	onMount(() => {
		ALL_TEMPLATES.forEach((template) => {
			injectionManager.registerTemplate(template);
		});
		addLog('info', t('debug.initialized'));

		window.addEventListener(EVENTS.HIDE_ALL_WEBVIEWS, handleHideAllWebviewsEvent as EventListener);
		window.addEventListener(EVENTS.RESTORE_WEBVIEWS, handleRestoreWebviewsEvent as EventListener);

		// Listen for injection result events from Rust (navigation intercept + decode)
		// Rust decodes base64url and sends parsed JSON directly
		const mainWindow = getCurrentWebviewWindow();
		logger.info('Registering injection result event listener');
		mainWindow.listen(EVENTS.CHILD_WEBVIEW_INJECTION_RESULT, (ev) => {
			const payload = ev.payload as { 
				id?: string; 
				result?: InjectionResult; 
				success?: boolean;
				error?: string;
			} | undefined;
			
			if (!payload) {
				logger.warn('Empty event payload received');
				return;
			}
			
			addLog('info', `Event received from webview: ${payload.id ?? 'unknown'}`);
			
			// Handle error response
			if (payload.success === false || payload.error) {
				addLog('error', `Injection error: ${payload.error || 'unknown'}`);
				result = {
					success: false,
					error: payload.error || 'Unknown error',
				};
				return;
			}
			
			// Handle success response (Rust already decoded the JSON)
			if (payload.result) {
				const parsed = payload.result;
				result = {
					success: parsed.success,
					actionsExecuted: parsed.actionsExecuted ?? 0,
					duration: parsed.duration ?? 0,
					error: parsed.success ? undefined : parsed.error,
				};
				
				// Extract content from results if available
				if ((parsed as any).results) {
					const extract = (parsed as any).results.find((r: any) => r.type === 'extract');
					if (extract?.result?.content) {
						extractedContent = extract.result.content;
						addLog('success', `Content extracted: ${extractedContent.slice(0, 80)}...`);
					}
				}
				
				addLog(
					parsed.success ? 'success' : 'error', 
					parsed.success 
						? `Injection completed in ${parsed.duration}ms` 
						: `Injection failed: ${parsed.error}`
				);
			}
		}).then(fn => { 
			unlistenInjectionResult = fn; 
			addLog('info', 'Event listener registered successfully');
		}).catch((e) => { 
			addLog('error', `Failed to register event listener: ${e}`); 
		});

		return () => {
			window.removeEventListener(
				EVENTS.HIDE_ALL_WEBVIEWS,
				handleHideAllWebviewsEvent as EventListener
			);
			window.removeEventListener(
				EVENTS.RESTORE_WEBVIEWS,
				handleRestoreWebviewsEvent as EventListener
			);
			if (unlistenInjectionResult) {
				try { unlistenInjectionResult(); } catch (_e) { /* ignore */ }
			}
		};
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
	 * 诊断脚本注入问题
	 */
	async function diagnoseInjection() {
		if (!webviewProxy) {
			addLog('error', '请先初始化 WebView');
			return;
		}

		try {
			loading = true;
			addLog('info', '===== 开始诊断注入问题 =====');

			// 测试 1: 最简单的脚本（立即返回）
			addLog('info', '[诊断 1/5] 测试基础脚本执行...');
			try {
				await webviewProxy.evaluateScript(`(function(){ return 'OK'; })();`, 3000);
				addLog('success', '✅ [诊断 1/5] 基础脚本可以执行');
			} catch (err) {
				addLog('error', `❌ [诊断 1/5] 基础脚本失败: ${err}`);
				addLog('error', '⚠️ WebView eval() 可能被 CSP 阻止！');
				return; // 后续测试没意义了
			}

			await new Promise(resolve => setTimeout(resolve, 300));

			// 测试 2: Console.log
			addLog('info', '[诊断 2/5] 测试 console.log...');
			try {
				await webviewProxy.evaluateScript(`
					(function(){
						console.log('[DIAGNOSTIC] Test 2: Console works!');
						console.error('[DIAGNOSTIC] Test 2: Error log works!');
						console.warn('[DIAGNOSTIC] Test 2: Warn log works!');
						return 'console-ok';
					})();
				`, 3000);
				addLog('success', '✅ [诊断 2/5] Console 脚本已发送（请查看子窗口控制台）');
			} catch (err) {
				addLog('error', `❌ [诊断 2/5] Console 脚本失败: ${err}`);
			}

			await new Promise(resolve => setTimeout(resolve, 300));

			// 测试 3: DOM 访问
			addLog('info', '[诊断 3/5] 测试 DOM 访问...');
			try {
				await webviewProxy.evaluateScript(`
					(function(){
						console.log('[DIAGNOSTIC] Test 3: URL =', window.location.href);
						console.log('[DIAGNOSTIC] Test 3: Title =', document.title);
						console.log('[DIAGNOSTIC] Test 3: Body exists =', !!document.body);
						return 'dom-ok';
					})();
				`, 3000);
				addLog('success', '✅ [诊断 3/5] DOM 访问脚本已发送');
			} catch (err) {
				addLog('error', `❌ [诊断 3/5] DOM 访问失败: ${err}`);
			}

			await new Promise(resolve => setTimeout(resolve, 300));

			// 测试 4: 查找 textarea
			addLog('info', '[诊断 4/5] 查找 textarea 元素...');
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
				`, 5000);
				addLog('success', '✅ [诊断 4/5] 元素搜索脚本已发送（查看控制台结果）');
			} catch (err) {
				addLog('error', `❌ [诊断 4/5] 元素搜索失败: ${err}`);
			}

			await new Promise(resolve => setTimeout(resolve, 300));

			// 测试 5: 查找发送按钮
			addLog('info', '[诊断 5/5] 查找发送按钮...');
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
				`, 5000);
				addLog('success', '✅ [诊断 5/5] 按钮搜索脚本已发送');
			} catch (err) {
				addLog('error', `❌ [诊断 5/5] 按钮搜索失败: ${err}`);
			}

			addLog('success', '===== 诊断完成！请查看子窗口控制台的 [DIAGNOSTIC] 日志 =====');
		} catch (error) {
			addLog('error', `诊断过程出错: ${error}`);
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

			// Generate script from template
			const script = injectionManager.generateFromTemplate(
				selectedPlatform.id,
				'Send Message',
				message
			);

			if (!script) {
				throw new Error(t('debug.templateNotFound'));
			}

			addLog('info', `${t('debug.generatedScript')}: ${script.length} ${t('debug.characters')}`);
			logger.info('Generated injection script:', script);

			// Execute injection
			const startTime = Date.now();
			await webviewProxy.evaluateScript<InjectionResult>(script);
			addLog('info', `脚本已发送，等待结果事件...`);
			const duration = Date.now() - startTime;
			// 结果将通过事件处理器 (CHILD_WEBVIEW_INJECTION_RESULT) 到达
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
	/**
	 * 测试单步执行 - 只填充
	 */
	async function testFillOnly() {
		if (!webviewProxy || !message.trim()) {
			addLog('error', '请输入消息');
			return;
		}

		try {
			loading = true;
			addLog('info', '[TEST] 测试填充功能...');

			const script = injectionManager.generateFill('#prompt-textarea', message, true, 5000);
			addLog('info', `[TEST] 生成的脚本长度: ${script.length}`);
			
			await webviewProxy.evaluateScript(script);
			addLog('success', '[TEST] 填充脚本已发送，请查看子窗口是否填充成功');
		} catch (error) {
			addLog('error', `[TEST] 填充失败: ${error}`);
		} finally {
			loading = false;
		}
	}

	/**
	 * 测试单步执行 - 只点击
	 */
	async function testClickOnly() {
		if (!webviewProxy) {
			addLog('error', '请先初始化 WebView');
			return;
		}

		try {
			loading = true;
			addLog('info', '[TEST] 测试点击功能...');

			const script = injectionManager.generateClick('button[data-testid="send-button"]', 3000);
			addLog('info', `[TEST] 生成的脚本长度: ${script.length}`);
			
			await webviewProxy.evaluateScript(script);
			addLog('success', '[TEST] 点击脚本已发送，请查看子窗口是否点击成功');
		} catch (error) {
			addLog('error', `[TEST] 点击失败: ${error}`);
		} finally {
			loading = false;
		}
	}

	/**
	 * 提取 AI 回复内容
	 */
	async function extractResponse() {
		if (!webviewProxy || !selectedPlatform) {
			addLog('error', '请先初始化 WebView');
			return;
		}

		try {
			loading = true;
			addLog('info', '开始提取 AI 回复...');

			// Use simple extract script
			const extractScript = `
				(function() {
					console.log('[EXTRACT-TEST] Starting extraction...');
					const ps = document.querySelectorAll('div[data-message-author-role="assistant"] p');
					console.log('[EXTRACT-TEST] Found paragraphs:', ps.length);
					const lastP = ps[ps.length - 1];
					console.log('[EXTRACT-TEST] Last paragraph:', lastP);
					const content = lastP?.textContent?.trim() || '';
					console.log('[EXTRACT-TEST] Content:', content);
					return { success: true, content };
				})();
			`;
			const result = await webviewProxy.evaluateScript<{ success: boolean; content: string }>(extractScript);
			if (result.success) {
				extractedContent = result.content;
				addLog('success', '✅ 提取成功：' + extractedContent);
			} else {
				throw new Error('提取脚本返回失败');
			}
		} catch (error) {
			addLog('error', `提取失败: ${error}`);
		} finally {
			loading = false;
		}
	}

	/**
	 * 返回设置页面
	 */
	function goBack() {
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

			<button class="control-btn" onclick={diagnoseInjection} disabled={loading} title="Diagnose Injection">
				🔍 诊断
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

				<!-- 测试按钮 -->
				<div class="test-buttons" style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
					<button class="btn btn-secondary" onclick={diagnoseInjection} disabled={loading}>
						🔍 诊断注入
					</button>
					<button class="btn btn-secondary" onclick={testFillOnly} disabled={loading || !message.trim()}>
						🧪 测试填充
					</button>
					<button class="btn btn-secondary" onclick={testClickOnly} disabled={loading}>
						🧪 测试点击
					</button>
					<button class="btn btn-info" onclick={extractResponse} disabled={loading}>
						📥 提取 AI 回复
					</button>
				</div>

				<!-- 显示提取的内容 -->
				{#if extractedContent}
					<div class="extracted-content">
						<h4>📝 提取的内容:</h4>
						<pre>{extractedContent}</pre>
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

	/* 提取控制样式 */
	.extract-section {
		margin-top: 0.5rem;
	}

	.btn-info {
		background-color: #3b82f6;
		color: white;
	}

	.btn-info:hover:not(:disabled) {
		background-color: #2563eb;
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

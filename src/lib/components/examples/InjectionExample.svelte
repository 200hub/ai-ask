<!--
  Example component demonstrating WebView injection usage
  This shows how to use the injection system to automatically fill and submit
  messages to AI platforms.
-->
<script lang="ts">
	import { ChildWebviewProxy, calculateChildWebviewBounds } from '$lib/utils/childWebview';
	import { injectionManager } from '$lib/utils/injection';
	import { ALL_TEMPLATES } from '$lib/utils/injection-templates';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { logger } from '$lib/utils/logger';
	import type { InjectionResult } from '$lib/types/injection';

	let webviewProxy: ChildWebviewProxy | null = null;
	let platformId = 'chatgpt';
	let message = '';
	let loading = false;
	let result: InjectionResult | null = null;

	// Register all built-in templates on component initialization
	ALL_TEMPLATES.forEach((template) => {
		injectionManager.registerTemplate(template);
	});

	async function initializeWebview() {
		try {
			loading = true;
			const mainWindow = getCurrentWebviewWindow();
			const bounds = await calculateChildWebviewBounds(mainWindow);

			// Get platform URL
			const platforms: Record<string, string> = {
				chatgpt: 'https://chat.openai.com',
				claude: 'https://claude.ai',
				gemini: 'https://gemini.google.com',
				deepseek: 'https://chat.deepseek.com',
				kimi: 'https://kimi.moonshot.cn'
			};

			const url = platforms[platformId];
			if (!url) {
				throw new Error(`Unknown platform: ${platformId}`);
			}

			// Create and initialize webview
			webviewProxy = new ChildWebviewProxy(platformId, url, null);
			await webviewProxy.ensure(bounds);
			await webviewProxy.show();

			// Wait for page to load
			await webviewProxy.waitForLoadFinished(15000);

			logger.info('WebView initialized', { platformId, url });
		} catch (error) {
			logger.error('Failed to initialize webview', error);
			result = {
				success: false,
				error: `Failed to initialize webview: ${error}`
			};
		} finally {
			loading = false;
		}
	}

	async function sendMessage() {
		if (!webviewProxy || !message.trim()) {
			return;
		}

		try {
			loading = true;
			result = null;

			// Find template for current platform
			const template = injectionManager.findTemplateForUrl(
				webviewProxy['url'] as string,
				platformId
			);

			if (!template) {
				throw new Error(`No template found for platform: ${platformId}`);
			}

			// Clone template and customize message content
			const customTemplate = JSON.parse(JSON.stringify(template));
			if (customTemplate.actions[0]?.type === 'fill') {
				customTemplate.actions[0].content = message;
			}

			// Generate and execute script
			const script = injectionManager.generateTemplateScript(customTemplate);
			logger.info('Executing injection script', {
				platformId,
				actionCount: customTemplate.actions.length
			});

			const rawResult = await webviewProxy.evaluateScript<InjectionResult>(script);
			result = injectionManager.parseResult(rawResult);

			if (result.success) {
				logger.info('Message sent successfully', result);
				message = ''; // Clear input on success
			} else {
				logger.error('Failed to send message', result);
			}
		} catch (error) {
			logger.error('Failed to execute injection', error);
			result = {
				success: false,
				error: String(error)
			};
		} finally {
			loading = false;
		}
	}

	async function closeWebview() {
		if (webviewProxy) {
			await webviewProxy.close();
			webviewProxy = null;
		}
	}
</script>

<div class="injection-example">
	<h2>WebView Injection Example</h2>

	<div class="controls">
		<label>
			Platform:
			<select bind:value={platformId} disabled={loading || webviewProxy !== null}>
				<option value="chatgpt">ChatGPT</option>
				<option value="claude">Claude</option>
				<option value="gemini">Gemini</option>
				<option value="deepseek">DeepSeek</option>
				<option value="kimi">Kimi</option>
			</select>
		</label>

		{#if !webviewProxy}
			<button onclick={initializeWebview} disabled={loading}>
				{loading ? 'Initializing...' : 'Initialize WebView'}
			</button>
		{:else}
			<button onclick={closeWebview} disabled={loading}> Close WebView </button>
		{/if}
	</div>

	{#if webviewProxy}
		<div class="message-input">
			<textarea bind:value={message} placeholder="Enter your message..." rows="4"></textarea>

			<button onclick={sendMessage} disabled={loading || !message.trim()}>
				{loading ? 'Sending...' : 'Send Message'}
			</button>
		</div>

		{#if result}
			<div class="result" class:success={result.success} class:error={!result.success}>
				{#if result.success}
					<h3>✓ Success</h3>
					<p>Actions executed: {result.actionsExecuted}</p>
					<p>Duration: {result.duration}ms</p>
				{:else}
					<h3>✗ Error</h3>
					<p>{result.error}</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.injection-example {
		padding: 1rem;
		max-width: 600px;
		margin: 0 auto;
	}

	h2 {
		color: var(--text-primary);
		margin-bottom: 1rem;
	}

	.controls {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
		align-items: center;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		color: var(--text-primary);
	}

	select {
		padding: 0.5rem;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	button {
		padding: 0.5rem 1rem;
		background: var(--accent-color);
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	button:hover:not(:disabled) {
		opacity: 0.9;
	}

	.message-input {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	textarea {
		padding: 0.5rem;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		resize: vertical;
		font-family: inherit;
	}

	.result {
		padding: 1rem;
		border-radius: 4px;
		margin-top: 1rem;
	}

	.result.success {
		background: rgba(0, 200, 0, 0.1);
		border: 1px solid rgba(0, 200, 0, 0.3);
	}

	.result.error {
		background: rgba(200, 0, 0, 0.1);
		border: 1px solid rgba(200, 0, 0, 0.3);
	}

	.result h3 {
		margin: 0 0 0.5rem;
		color: var(--text-primary);
	}

	.result p {
		margin: 0.25rem 0;
		color: var(--text-secondary);
	}
</style>

/**
 * Response Monitor Store
 * 
 * 轮询子 webview 检查 AI 回复，并通过事件通知主窗口
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '$lib/utils/logger';
import { injectionManager } from '$lib/utils/injection';

interface AIResponse {
	platformId: string;
	content: string;
	isComplete: boolean;
	timestamp: number;
}

interface MonitorState {
	platformId: string;
	webviewId: string;
	isActive: boolean;
	pollInterval: number; // ms
	lastResponse: AIResponse | null;
}

/**
 * Response Monitor - 监听子 webview 中的 AI 回复
 */
class ResponseMonitor {
	private monitors = $state<Map<string, MonitorState>>(new Map());
	private timers = new Map<string, number>();
	private callbacks = new Map<string, (response: AIResponse) => void>();

	/**
	 * 开始监听特定平台的回复
	 */
	async startMonitoring(
		platformId: string,
		webviewId: string,
		responseSelector: string,
		pollInterval: number = 1000,
		onResponse?: (response: AIResponse) => void
	): Promise<void> {
		const key = `${platformId}-${webviewId}`;

		// 如果已经在监听，先停止
		if (this.monitors.has(key)) {
			this.stopMonitoring(platformId, webviewId);
		}

		logger.info('[ResponseMonitor] Starting monitoring', { platformId, webviewId, responseSelector });

		// 首先在子 webview 中设置监听脚本
		const setupScript = injectionManager.generateResponseMonitorSetupScript(
			platformId,
			responseSelector
		);

		try {
			await invoke('evaluate_child_webview_script', {
				payload: {
					id: webviewId,
					script: setupScript
				}
			});

			logger.info('[ResponseMonitor] Setup script executed successfully');
		} catch (error) {
			logger.error('[ResponseMonitor] Failed to setup monitoring', error);
			throw error;
		}

		// 创建监听状态
		const state: MonitorState = {
			platformId,
			webviewId,
			isActive: true,
			pollInterval,
			lastResponse: null
		};

		this.monitors.set(key, state);

		if (onResponse) {
			this.callbacks.set(key, onResponse);
		}

		// 开始轮询
		this.startPolling(key, state);
	}

	/**
	 * 停止监听
	 */
	stopMonitoring(platformId: string, webviewId: string): void {
		const key = `${platformId}-${webviewId}`;
		
		// 清除定时器
		const timer = this.timers.get(key);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(key);
		}

		// 清除状态
		this.monitors.delete(key);
		this.callbacks.delete(key);

		logger.info('[ResponseMonitor] Stopped monitoring', { platformId, webviewId });
	}

	/**
	 * 停止所有监听
	 */
	stopAll(): void {
		for (const key of this.monitors.keys()) {
			const timer = this.timers.get(key);
			if (timer) {
				clearInterval(timer);
			}
		}

		this.timers.clear();
		this.monitors.clear();
		this.callbacks.clear();

		logger.info('[ResponseMonitor] Stopped all monitoring');
	}

	/**
	 * 开始轮询检查回复
	 */
	private startPolling(key: string, state: MonitorState): void {
		const poll = async () => {
			if (!state.isActive) {
				return;
			}

			try {
				// Generate check script that stores result in window variable
				const checkScript = injectionManager.generateResponseCheckScript();
				
				logger.debug('[ResponseMonitor] Sending check script', { 
					scriptLength: checkScript.length,
					scriptPreview: checkScript.substring(0, 100) + '...'
				});
				
				// Execute the check script
				await invoke<unknown>('evaluate_child_webview_script', {
					payload: {
						id: state.webviewId,
						script: checkScript
					}
				});
				
				logger.debug('[ResponseMonitor] Check script sent successfully');

				// Now read the result from window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__
				const resultScript = `
					(function() {
						if (window.__AI_ASK_MONITOR__ && window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__) {
							const result = window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__;
							delete window.__AI_ASK_MONITOR__.__LAST_CHECK_RESULT__;
							return result;
						}
						return { hasNew: false, message: 'No result available' };
					})()
				`.trim();

				const result = await invoke<unknown>('evaluate_child_webview_script', {
					payload: {
						id: state.webviewId,
						script: resultScript
					}
				});

				logger.debug('[ResponseMonitor] Poll result received', { result });

				// 解析结果
				if (typeof result === 'object' && result !== null) {
					const checkResult = result as {
						hasNew: boolean;
						message?: string;
						platformId?: string;
						response?: {
							content: string;
							isComplete: boolean;
							timestamp: number;
						};
						error?: string;
					};

					if (checkResult.error) {
						logger.warn('[ResponseMonitor] Check script error', checkResult.error);
					} else if (checkResult.hasNew && checkResult.response) {
						const response: AIResponse = {
							platformId: state.platformId,
							content: checkResult.response.content,
							isComplete: checkResult.response.isComplete,
							timestamp: checkResult.response.timestamp
						};

						// 更新最后一次回复
						state.lastResponse = response;

						// 触发回调
						const callback = this.callbacks.get(key);
						if (callback) {
							callback(response);
						}

						logger.info('[ResponseMonitor] New response detected', {
							platformId: state.platformId,
							contentLength: response.content.length,
							isComplete: response.isComplete
						});
					} else if (checkResult.message) {
						logger.debug('[ResponseMonitor] No new response', checkResult.message);
					}
				} else {
					logger.warn('[ResponseMonitor] Invalid result format', { result });
				}
			} catch (error) {
				logger.error('[ResponseMonitor] Polling error', error);
			}
		};

		// 立即执行一次
		poll();

		// 开始定时轮询
		const timer = setInterval(poll, state.pollInterval);
		this.timers.set(key, timer as unknown as number);
	}

	/**
	 * 获取最后一次回复
	 */
	getLastResponse(platformId: string, webviewId: string): AIResponse | null {
		const key = `${platformId}-${webviewId}`;
		const state = this.monitors.get(key);
		return state?.lastResponse ?? null;
	}

	/**
	 * 检查是否正在监听
	 */
	isMonitoring(platformId: string, webviewId: string): boolean {
		const key = `${platformId}-${webviewId}`;
		return this.monitors.has(key) && (this.monitors.get(key)?.isActive ?? false);
	}
}

/**
 * 单例导出
 */
export const responseMonitor = new ResponseMonitor();

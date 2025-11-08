/**
 * Selection Toolbar State Management - 使用 Svelte 5 Runes
 */
import { logger } from '../utils/logger';

/**
 * 工具栏位置接口
 */
export interface ToolbarPosition {
  x: number;
  y: number;
}

/**
 * 划词工具栏状态管理类
 */
class ToolbarStore {
  /** 选中的文本 */
  selectedText = $state<string>('');

  /** 工具栏是否可见 */
  visible = $state<boolean>(false);

  /** 工具栏位置 (屏幕坐标) */
  position = $state<ToolbarPosition>({ x: 0, y: 0 });

  /** 是否正在执行操作 */
  isProcessing = $state<boolean>(false);

  /**
   * 显示工具栏
   * 
   * @param text - 选中的文本
   * @param position - 光标位置
   */
  show(text: string, position: ToolbarPosition) {
    if (!text || text.trim().length === 0) {
      logger.warn('Selection toolbar: Empty text, not showing');
      return;
    }

    this.selectedText = text.trim();
    this.position = position;
    this.visible = true;
    
    logger.info('Selection toolbar shown', { 
      textLength: this.selectedText.length, 
      position 
    });
  }

  /**
   * 隐藏工具栏
   */
  hide() {
    this.visible = false;
    this.selectedText = '';
    this.isProcessing = false;
    
    logger.info('Selection toolbar hidden');
  }

  /**
   * 设置处理状态
   */
  setProcessing(processing: boolean) {
    this.isProcessing = processing;
  }

  /**
   * 清空状态
   */
  reset() {
    this.selectedText = '';
    this.visible = false;
    this.position = { x: 0, y: 0 };
    this.isProcessing = false;
  }
}

/**
 * 导出单例实例
 */
export const toolbarStore = new ToolbarStore();

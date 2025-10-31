/**
 * 统一日志管理系统
 * 
 * 提供统一的日志记录接口，支持：
 * - 四个日志级别：ERROR, WARN, INFO, DEBUG
 * - 日志历史管理（自动清理）
 * - 开发/生产环境自适应输出
 * - 日志导出功能
 */

/**
 * 日志级别枚举
 * 
 * 级别越低，重要性越高
 * - ERROR (0): 错误信息，始终记录和输出
 * - WARN (1): 警告信息，生产环境也会输出
 * - INFO (2): 一般信息，仅开发环境输出
 * - DEBUG (3): 调试信息，仅开发环境输出
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * 日志条目接口
 */
interface LogEntry {
  /** 日志时间戳 */
  timestamp: Date;
  /** 日志级别 */
  level: LogLevel;
  /** 日志消息 */
  message: string;
  /** 额外的数据参数 */
  data?: unknown[];
}

/**
 * 日志管理器类（单例模式）
 * 
 * 核心功能：
 * - 记录日志到内存缓冲区
 * - 根据环境和日志级别决定是否输出到控制台
 * - 管理日志历史（自动清理超过限制的旧日志）
 * - 提供日志查询和导出功能
 */
class Logger {
  /** 单例实例 */
  private static instance: Logger;
  
  /** 日志历史记录 */
  private logs: LogEntry[] = [];
  
  /** 最大日志条数（防止内存溢出） */
  private readonly maxLogs = 1000;

  /**
   * 私有构造函数（单例模式）
   */
  private constructor() {}

  /**
   * 获取日志管理器单例实例
   * 
   * @returns Logger 单例实例
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * 记录日志（内部方法）
   * 
   * @param level - 日志级别
   * @param message - 日志消息
   * @param data - 额外的数据参数
   */
  private log(level: LogLevel, message: string, ...data: unknown[]): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      data: data.length > 0 ? data : undefined,
    };

    // 添加到日志历史
    this.logs.push(entry);
    
    // 清理老旧日志
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // 根据环境和日志级别决定是否输出到控制台
    if (this.shouldConsoleLog(level)) {
      this.consoleOutput(entry);
    }
  }

  /**
   * 判断是否应该输出到控制台
   * 
   * 规则：
   * - 开发环境：输出所有日志
   * - 生产环境：只输出 ERROR 和 WARN
   * 
   * @param level - 日志级别
   * @returns 是否应该输出到控制台
   */
  private shouldConsoleLog(level: LogLevel): boolean {
    // 开发环境：输出所有日志
    if (import.meta.env.DEV) {
      return true;
    }
    
    // 生产环境：只输出错误和警告
    return level <= LogLevel.WARN;
  }

  /**
   * 输出日志到控制台
   * 
   * 根据日志级别选择合适的控制台方法（error/warn/info/log）
   * 
   * @param entry - 日志条目
   */
  private consoleOutput(entry: LogEntry): void {
    const { timestamp, level, message, data } = entry;
    const timeStr = timestamp.toLocaleTimeString();
    const prefix = `[${timeStr}] ${this.getLevelName(level)}:`;
    
    switch (level) {
      case LogLevel.ERROR:
        console.error(prefix, message, ...(data || []));
        break;
      case LogLevel.WARN:
        console.warn(prefix, message, ...(data || []));
        break;
      case LogLevel.INFO:
        console.info(prefix, message, ...(data || []));
        break;
      case LogLevel.DEBUG:
        console.log(prefix, message, ...(data || []));
        break;
    }
  }

  /**
   * 获取日志级别的显示名称
   * 
   * @param level - 日志级别
   * @returns 日志级别的字符串表示
   */
  private getLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.ERROR: return 'ERROR';
      case LogLevel.WARN: return 'WARN';
      case LogLevel.INFO: return 'INFO';
      case LogLevel.DEBUG: return 'DEBUG';
      default: return 'UNKNOWN';
    }
  }

  // ========== 公共 API ==========

  /**
   * 记录错误日志
   * 
   * 始终记录并输出到控制台（开发和生产环境）
   * 
   * @param message - 错误消息
   * @param data - 额外的数据参数
   */
  public error(message: string, ...data: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...data);
  }

  /**
   * 记录警告日志
   * 
   * 始终记录并输出到控制台（开发和生产环境）
   * 
   * @param message - 警告消息
   * @param data - 额外的数据参数
   */
  public warn(message: string, ...data: unknown[]): void {
    this.log(LogLevel.WARN, message, ...data);
  }

  /**
   * 记录信息日志
   * 
   * 始终记录，仅在开发环境输出到控制台
   * 
   * @param message - 信息消息
   * @param data - 额外的数据参数
   */
  public info(message: string, ...data: unknown[]): void {
    this.log(LogLevel.INFO, message, ...data);
  }

  /**
   * 记录调试日志
   * 
   * 始终记录，仅在开发环境输出到控制台
   * 
   * @param message - 调试消息
   * @param data - 额外的数据参数
   */
  public debug(message: string, ...data: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...data);
  }

  /**
   * 获取日志历史
   * 
   * @param maxCount - 最大返回数量（可选，默认返回全部）
   * @returns 日志条目数组的副本
   */
  public getLogs(maxCount?: number): LogEntry[] {
    return maxCount ? this.logs.slice(-maxCount) : [...this.logs];
  }

  /**
   * 清空所有日志历史
   */
  public clearLogs(): void {
    this.logs = [];
  }

  /**
   * 导出日志为 JSON 字符串
   * 
   * 可用于导出日志到文件或发送到服务器
   * 
   * @returns 格式化的 JSON 字符串
   */
  public exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// ========== 导出 ==========

/**
 * 导出日志管理器单例实例
 * 
 * 使用示例：
 * ```typescript
 * import { logger } from '$lib/utils/logger';
 * 
 * logger.error('发生错误', { code: 500 });
 * logger.info('应用启动成功');
 * ```
 */
export const logger = Logger.getInstance();

/**
 * 便捷的全局日志函数
 * 
 * 提供更简洁的日志记录方式
 * 
 * 使用示例：
 * ```typescript
 * import { log } from '$lib/utils/logger';
 * 
 * log.error('错误信息');
 * log.warn('警告信息');
 * log.info('提示信息');
 * log.debug('调试信息');
 * ```
 */
export const log = {
  error: (message: string, ...data: unknown[]): void => logger.error(message, ...data),
  warn: (message: string, ...data: unknown[]): void => logger.warn(message, ...data),
  info: (message: string, ...data: unknown[]): void => logger.info(message, ...data),
  debug: (message: string, ...data: unknown[]): void => logger.debug(message, ...data),
};
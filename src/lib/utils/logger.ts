/**
 * 统一日志管理系统
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  data?: unknown[];
}

class Logger {
  private static instance: Logger;
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // 最大日志条数

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, ...data: unknown[]) {
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
   * 控制台输出
   */
  private consoleOutput(entry: LogEntry) {
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
   * 获取日志级别名称
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

  // 公共方法
  public error(message: string, ...data: unknown[]) {
    this.log(LogLevel.ERROR, message, ...data);
  }

  public warn(message: string, ...data: unknown[]) {
    this.log(LogLevel.WARN, message, ...data);
  }

  public info(message: string, ...data: unknown[]) {
    this.log(LogLevel.INFO, message, ...data);
  }

  public debug(message: string, ...data: unknown[]) {
    this.log(LogLevel.DEBUG, message, ...data);
  }

  /**
   * 获取日志历史
   */
  public getLogs(maxCount?: number): LogEntry[] {
    return maxCount ? this.logs.slice(-maxCount) : [...this.logs];
  }

  /**
   * 清理日志
   */
  public clearLogs() {
    this.logs = [];
  }

  /**
   * 导出日志为 JSON 字符串
   */
  public exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// 导出单例实例
export const logger = Logger.getInstance();

// 便捷的全局日志函数
export const log = {
  error: (message: string, ...data: unknown[]) => logger.error(message, ...data),
  warn: (message: string, ...data: unknown[]) => logger.warn(message, ...data),
  info: (message: string, ...data: unknown[]) => logger.info(message, ...data),
  debug: (message: string, ...data: unknown[]) => logger.debug(message, ...data),
};
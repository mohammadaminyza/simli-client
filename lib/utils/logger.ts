import {isDevelopment} from './environment';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const logStyles: Record<LogLevel, string> = {
    debug: 'color: #999797; font-weight: bold;',
    info: 'color: #3469d1; font-weight: bold;',
    warn: 'color: #d17834; font-weight: bold;',
    error: 'color: #d13434; font-weight: bold;',
};

class Logger {
    private static instance: Logger;
    private readonly isDevelopment: boolean;

    private constructor() {
        this.isDevelopment = isDevelopment();
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private formatMessage(level: LogLevel, message: string): [string, string] {
        const timestamp = new Date().toISOString();
        const style = logStyles[level] || '';
        return [`%c[${timestamp}] [${level.toUpperCase()}] ${message}`, style];
    }

    private shouldLog(level: LogLevel): boolean {
        return this.isDevelopment && level !== 'debug';
    }

    public debug(message: string, ...args: any[]): void {
        if (this.shouldLog('debug')) {
            console.debug(...this.formatMessage('debug', message), ...args);
        }
    }

    public info(message: string, ...args: any[]): void {
        if (this.shouldLog('info')) {
            console.info(...this.formatMessage('info', message), ...args);
        }
    }

    public warn(message: string, ...args: any[]): void {
        if (this.shouldLog('warn')) {
            console.warn(...this.formatMessage('warn', message), ...args);
        }
    }

    public error(message: string, ...args: any[]): void {
        if (this.shouldLog('error')) {
            console.error(...this.formatMessage('error', message), ...args);
        }
    }
}

export const logger = Logger.getInstance(); 
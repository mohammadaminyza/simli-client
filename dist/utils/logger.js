"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const environment_1 = require("./environment");
const logStyles = {
    debug: 'color: #999797; font-weight: bold;',
    info: 'color: #3469d1; font-weight: bold;',
    warn: 'color: #d17834; font-weight: bold;',
    error: 'color: #d13434; font-weight: bold;',
};
class Logger {
    constructor() {
        this.isDevelopment = (0, environment_1.isDevelopment)();
    }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        const style = logStyles[level] || '';
        return [`%c[${timestamp}] [${level.toUpperCase()}] ${message}`, style];
    }
    shouldLog(level) {
        return this.isDevelopment && level !== 'debug';
    }
    debug(message, ...args) {
        if (this.shouldLog('debug')) {
            console.debug(...this.formatMessage('debug', message), ...args);
        }
    }
    info(message, ...args) {
        if (this.shouldLog('info')) {
            console.info(...this.formatMessage('info', message), ...args);
        }
    }
    warn(message, ...args) {
        if (this.shouldLog('warn')) {
            console.warn(...this.formatMessage('warn', message), ...args);
        }
    }
    error(message, ...args) {
        if (this.shouldLog('error')) {
            console.error(...this.formatMessage('error', message), ...args);
        }
    }
}
exports.logger = Logger.getInstance();

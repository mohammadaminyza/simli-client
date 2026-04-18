"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.LogLevel = void 0;
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["ERROR"] = 2] = "ERROR";
    LogLevel[LogLevel["CRITICAL"] = 3] = "CRITICAL";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
class Logger {
    currentLevel;
    destination;
    session_id;
    constructor(level = LogLevel.INFO) {
        this.currentLevel = level;
        this.destination = null;
        this.session_id = null;
    }
    formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        const destination = this.destination ?? 'not_received';
        const sessionId = this.session_id ?? 'not_received';
        return `SimliClient | ${timestamp} | ${level} | ${destination}/${sessionId} | ${message}`;
    }
    log(level, levelName, message, ...args) {
        if (level < this.currentLevel) {
            return;
        }
        const formattedMessage = this.formatMessage(levelName, message);
        switch (level) {
            case LogLevel.DEBUG:
            case LogLevel.INFO:
                console.log(formattedMessage, ...args);
                break;
            case LogLevel.ERROR:
            case LogLevel.CRITICAL:
                console.error(formattedMessage, ...args);
                break;
        }
    }
    debug(message, ...args) {
        this.log(LogLevel.DEBUG, 'DEBUG', message, ...args);
    }
    info(message, ...args) {
        this.log(LogLevel.INFO, 'INFO', message, ...args);
    }
    error(message, ...args) {
        this.log(LogLevel.ERROR, 'ERROR', message, ...args);
    }
    critical(message, ...args) {
        this.log(LogLevel.CRITICAL, 'CRITICAL', message, ...args);
    }
    setLevel(level) {
        this.currentLevel = level;
    }
    getLevel() {
        return this.currentLevel;
    }
}
exports.Logger = Logger;

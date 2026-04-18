export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    ERROR = 2,
    CRITICAL = 3
}
export declare class Logger {
    private currentLevel;
    destination: string | null;
    session_id: string | null;
    constructor(level?: LogLevel);
    private formatMessage;
    private log;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    critical(message: string, ...args: any[]): void;
    setLevel(level: LogLevel): void;
    getLevel(): LogLevel;
}

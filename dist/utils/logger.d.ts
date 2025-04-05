declare class Logger {
    private static instance;
    private readonly isDevelopment;
    private constructor();
    static getInstance(): Logger;
    private formatMessage;
    private shouldLog;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}
export declare const logger: Logger;
export {};

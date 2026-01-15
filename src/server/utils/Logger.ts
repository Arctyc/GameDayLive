import { settings } from '@devvit/web/server';

export enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace
}

export class Logger {

    #label: string;
    #logLevel: LogLevel;
    #traceName: string | undefined;

    public static async Create(label: string): Promise<Logger> {
        return new Logger(label, await Logger.GetLogLevelSetting());
    }

    public static async GetLogLevelSetting(): Promise<LogLevel> {
        const savedLvl = await settings.get<string[]>('logLevel');
        const key = savedLvl?.[0];
        return (key ? LogLevel[key as keyof typeof LogLevel] : LogLevel.Info) ?? LogLevel.Info;
    }

    public constructor(label: string, logLevel?: LogLevel) {
        this.#label = label;
        this.#logLevel = logLevel ?? LogLevel.Warn;
    }

    public get label() { return this.#label; }
    public set label(val: string) { this.#label = val; }
    public get logLevel() { return this.#logLevel; }
    public set logLevel(val: LogLevel) { this.#logLevel = val; }

    public traceStart(name: string) {
        this.#traceName = name;
        this.trace(`===== Start - ${name} =====`);
    }

    public traceEnd() {
        if (!this.#traceName) throw new Error('traceEnd was called before traceStart');
        this.trace(`===== End - ${this.#traceName} =====`);
        this.#traceName = undefined;
    }

    public trace(...msg: unknown[]): void {
        if (this.isLogEnabled(LogLevel.Trace))
            console.trace(this.formatMessage(LogLevel.Trace, ...msg));
    }

    public debug(...msg: unknown[]): void {
        if (this.isLogEnabled(LogLevel.Debug))
            console.debug(this.formatMessage(LogLevel.Debug, ...msg));
    }

    public info(...msg: unknown[]): void {
        if (this.isLogEnabled(LogLevel.Info))
            console.log(this.formatMessage(LogLevel.Info, ...msg));
    }

    public warn(...msg: unknown[]): void {
        if (this.isLogEnabled(LogLevel.Warn))
            console.warn(this.formatMessage(LogLevel.Warn, ...msg));
    }

    public error(...msg: unknown[]): void {
        if (this.isLogEnabled(LogLevel.Error))
            console.error(this.formatMessage(LogLevel.Error, ...msg));
    }

    public isLogEnabled(level: LogLevel): boolean {
        return level <= this.#logLevel;
    }

    private getLogDateFormat(): string {
        const d = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }

    private formatError(e: Error): string {
        let txt = '';
        if (e.stack) txt += `--- Stack Trace:\n${e.stack}\n`;
        const cause = (e as any)?.cause?.stack || (e as any)?.cause;
        if (cause) txt += `--- Cause:\n${cause}\n`;
        return txt ? `\n----------\n${e}\n${txt}----------` : `${e}`;
    }

    private formatMessage(level: LogLevel, ...msg: unknown[]): string {
        const msgFmt = msg.map(o =>
            o === undefined ? '<undefined>' :
            o === null ? '<null>' :
            o instanceof Error ? this.formatError(o) :
            (Array.isArray(o) || typeof o === 'object') ? JSON.stringify(o) :
            `${o}`
        );
        return `${this.getLogDateFormat()} [${this.#label}] ${LogLevel[level].toUpperCase()} - ${msgFmt.join(' ')}`;
    }
}
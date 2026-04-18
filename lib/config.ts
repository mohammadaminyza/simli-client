interface SimliClientConfig {
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
    enableSFU: boolean;
    model: "fasttalk" | "artalk";
}

export type {SimliClientConfig}
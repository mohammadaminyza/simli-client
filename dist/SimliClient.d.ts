import { ConnectionState } from 'livekit-client';
interface SimliClientConfig {
    apiKey?: string;
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
    session_token?: string;
    videoRef: HTMLVideoElement;
    audioRef: HTMLAudioElement;
    enableConsoleLogs?: boolean;
    SimliURL?: string;
    token?: string | null;
    ticket?: string | null;
    maxRetryAttempts?: number | 100;
    retryDelay_ms?: number | 2000;
    videoReceivedTimeout?: number | 15000;
    enableSFU?: boolean | true;
    model?: "fasttalk" | "artalk";
}
interface SimliSessionRequest {
    isJPG: boolean;
    apiKey?: string;
    syncAudio: boolean;
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
    model: "fasttalk" | "artalk";
}
interface SimliSessionToken {
    session_token: string;
}
interface SimliClientEvents {
    connected: () => void;
    disconnected: () => void;
    failed: (reason: string) => void;
    speaking: () => void;
    silent: () => void;
}
declare class SimliClient {
    private pc;
    private apiKey?;
    private session_token?;
    private token?;
    private ticket?;
    private handleSilence;
    private videoRef;
    private audioRef;
    private errorReason;
    private sessionInitialized;
    private inputStreamTrack;
    private sourceNode;
    private audioWorklet;
    private audioBuffer;
    private maxSessionLength;
    private maxIdleTime;
    private model;
    private webSocket;
    private lastSendTime;
    private MAX_RETRY_ATTEMPTS;
    private RETRY_DELAY;
    private connectionTimeout;
    private readonly CONNECTION_TIMEOUT_MS;
    isAvatarSpeaking: boolean;
    enableConsoleLogs: boolean;
    private events;
    private retryAttempt;
    private inputIceServers;
    private videoReceived;
    config: SimliClientConfig | null;
    private SimliURL;
    private SimliWSURL;
    private audioContext;
    private start_stamp;
    on<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    off<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    private emit;
    Initialize(config: SimliClientConfig): void;
    private setupConnectionStateHandler;
    start(retryAttempt?: number): Promise<void>;
    private sendPingMessage;
    createSessionToken(SimliURL: string, metadata: SimliSessionRequest): Promise<SimliSessionToken>;
    private sendSessionToken;
    private handleConnectionFailure;
    private handleConnectionTimeout;
    private handleDisconnection;
    private cleanup;
    private clearTimeouts;
    listenToMediastreamTrack(stream: MediaStreamTrack): void;
    private initializeAudioWorklet;
    sendAudioData(audioData: Uint8Array): void;
    sendAudioDataImmediate(audioData: Uint8Array): void;
    close(): void;
    ClearBuffer: () => void;
    isConnected(): boolean;
    getConnectionStatus(): {
        sessionInitialized: boolean;
        webSocketState: number | null;
        peerConnectionState: ConnectionState | null;
        errorReason: string | null;
    };
    private setupWebSocketListeners;
}
export { SimliClient, SimliClientConfig, SimliClientEvents };

interface SimliClientConfig {
    avatarId: string;
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
    videoRef: HTMLVideoElement;
    audioRef: HTMLAudioElement;
    enableConsoleLogs?: boolean;
    SimliURL: string | "";
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
    private dc;
    private dcInterval;
    private candidateCount;
    private prevCandidateCount;
    private avatarId;
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
    private pingSendTimes;
    private webSocket;
    private lastSendTime;
    private readonly MAX_RETRY_ATTEMPTS;
    private readonly RETRY_DELAY;
    private connectionTimeout;
    private readonly CONNECTION_TIMEOUT_MS;
    private SimliURL;
    isAvatarSpeaking: boolean;
    enableConsoleLogs: boolean;
    private events;
    on<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    off<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    private emit;
    Initialize(config: SimliClientConfig): void;
    private getIceServers;
    private createPeerConnection;
    private setupPeerConnectionListeners;
    private setupConnectionStateHandler;
    start(retryAttempt?: number): Promise<void>;
    private setupDataChannelListeners;
    private startDataChannelInterval;
    private stopDataChannelInterval;
    private sendPingMessage;
    private initializeSession;
    private negotiate;
    private waitForIceGathering;
    private handleConnectionFailure;
    private handleConnectionTimeout;
    private handleDisconnection;
    private cleanup;
    private clearTimeouts;
    listenToMediastreamTrack(stream: MediaStreamTrack): void;
    private initializeAudioWorklet;
    sendAudioData(audioData: Uint8Array): void;
    close(): void;
    ClearBuffer: () => void;
    isConnected(): boolean;
    getConnectionStatus(): {
        sessionInitialized: boolean;
        webSocketState: number | null;
        peerConnectionState: RTCPeerConnectionState | null;
        errorReason: string | null;
    };
    private getWebSocketUrl;
}
export { SimliClient, SimliClientConfig, SimliClientEvents };

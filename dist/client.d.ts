import { SimliClientEvents } from './events';
import { Logger, LogLevel } from './Logger';
interface SimliSessionRequest {
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
    model?: "fasttalk" | "artalk";
}
interface TokenRequestData {
    config: SimliSessionRequest;
}
interface SimliSessionToken {
    session_token: string;
}
type TransportMode = "livekit" | "p2p";
type SignalingMode = "websockets";
type session_token = string;
declare function generateSimliSessionToken(request: TokenRequestData, SimliURL?: string, token?: string | null): Promise<SimliSessionToken>;
declare function generateIceServers(SimliURL?: string): Promise<RTCIceServer[]>;
declare class SimliClient {
    session_token: string;
    transport: TransportMode;
    signaling: SignalingMode;
    videoElement: HTMLVideoElement;
    audioElement: HTMLAudioElement;
    audioBufferSize: number;
    private connection;
    private connectionTimeout;
    private connectionResolve;
    private connectionReject;
    private connectionPromise;
    private sourceNode;
    private audioWorklet;
    private readonly MAX_RETRY_ATTEMPTS;
    private RETRY_DELAY;
    private readonly CONNECTION_TIMEOUT_MS;
    private retryAttempt;
    private SimliWSURL;
    private audioContext;
    private logger;
    private iceServers;
    private persistent_events;
    private failReason;
    private shouldStop;
    constructor(session_token: session_token, videoElement: HTMLVideoElement, audioElement: HTMLAudioElement, iceServers: RTCIceServer[] | null, logLevel?: LogLevel, transport_mode?: TransportMode, signaling?: SignalingMode, SimliWSURL?: string, audioBufferSize?: number);
    on<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    off<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    listenToMediastreamTrack(stream: MediaStreamTrack): void;
    ClearBuffer: () => void;
    sendAudioData(audioData: Uint8Array): void;
    sendAudioDataImmediate(audioData: Uint8Array): void;
    /**
     * Your customization: extracted shared transport-construction logic into a
     * helper so both the constructor and resetConnections stay DRY.
     */
    private buildTransport;
    private resetConnections;
    private initializeAudioWorklet;
}
export { SimliClient, generateSimliSessionToken, generateIceServers, Logger, LogLevel };
export type { SimliSessionRequest };

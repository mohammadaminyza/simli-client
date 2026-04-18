import { WebSocketSignaling } from "../signaling/WebSocketSignaling";
import { SimliClientEvents } from "../events";
import { BaseTransport, EventMap } from "./BaseTransport";
import { Logger } from "../Logger";
declare class P2PTransport implements BaseTransport {
    videoElementAnchor: HTMLVideoElement;
    audioElementAnchor: HTMLAudioElement;
    signalingConnection: WebSocketSignaling;
    session_token: string;
    pc: RTCPeerConnection;
    events: EventMap;
    logger: Logger;
    private iceCandidateCount;
    private previousIceCandidateCount;
    private iceTimeout;
    private websocketPromise;
    private websocketReject;
    constructor(simliBaseWSURL: string, session_token: string, enableSFU: boolean, iceServers: RTCIceServer[], videoElementAnchor: HTMLVideoElement, audioElementAnchor: HTMLAudioElement, logger: Logger, failSignal: (message: string) => void);
    on<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    off<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    emit<K extends keyof SimliClientEvents>(event: K, ...args: Parameters<SimliClientEvents[K]>): void;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    private registerPeerInfo;
    private waitForIceGathering;
    private setupPeerConnectionListeners;
}
export { P2PTransport };

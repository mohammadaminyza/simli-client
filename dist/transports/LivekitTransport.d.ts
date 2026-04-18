import { Room } from "livekit-client";
import { WebSocketSignaling } from "../signaling/WebSocketSignaling";
import { SimliClientEvents } from "../events";
import { BaseTransport, EventMap } from "./BaseTransport";
import { Logger } from "../Logger";
declare class LivekitTransport implements BaseTransport {
    videoElementAnchor: HTMLVideoElement;
    audioElementAnchor: HTMLAudioElement;
    signalingConnection: WebSocketSignaling;
    session_token: string;
    pc: Room;
    logger: Logger;
    events: EventMap;
    private websocketPromise;
    private websocketReject;
    constructor(simliBaseWSURL: string, session_token: string, videoElementAnchor: HTMLVideoElement, audioElementAnchor: HTMLAudioElement, logger: Logger, failSignal: (message: string) => void);
    on<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    off<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    emit<K extends keyof SimliClientEvents>(event: K, ...args: Parameters<SimliClientEvents[K]>): void;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    private join_lk_room;
    private setupConnectionStateHandler;
}
export { LivekitTransport };

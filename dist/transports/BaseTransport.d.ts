import { SimliClientEvents } from "../events";
import { Logger } from "../Logger";
import { BaseSignaling } from "../signaling/BaseSignaling";
type EventCallback = (...args: any[]) => void;
type EventMap = Map<string, Set<EventCallback>>;
interface BaseTransport {
    videoElementAnchor: HTMLVideoElement;
    audioElementAnchor: HTMLAudioElement;
    signalingConnection: BaseSignaling;
    session_token: string;
    events: EventMap;
    logger: Logger;
    connect(): Promise<void>;
    disconnect(): void;
    on<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    off<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    emit<K extends keyof SimliClientEvents>(event: K, ...args: Parameters<SimliClientEvents[K]>): void;
}
declare function register_destination(logger: Logger, serialized_info: string): void;
declare function handleMessage(transport: BaseTransport, message: MessageEvent): Promise<void>;
export { handleMessage, register_destination };
export type { BaseTransport, EventCallback, EventMap };

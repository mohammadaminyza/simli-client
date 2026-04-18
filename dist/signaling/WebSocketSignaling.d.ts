import { Logger } from "../Logger";
import { BaseSignaling, ClientSignals } from "./BaseSignaling";
declare class WebSocketSignaling implements BaseSignaling {
    wsURL: string | URL;
    wsConnection: WebSocket;
    logger: Logger;
    constructor(wsURL: string | URL, logger: Logger);
    connect(connected: () => void): Promise<void>;
    disconnect(): void;
    private send;
    sendOffer(offer: RTCSessionDescription): void;
    sendSignal(data: ClientSignals): void;
    sendAudioData(audioData: Uint8Array): void;
    sendAudioDataImmediate(audioData: Uint8Array): void;
}
export { WebSocketSignaling };

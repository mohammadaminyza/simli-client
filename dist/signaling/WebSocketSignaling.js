"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketSignaling = void 0;
const Logger_1 = require("../Logger");
class WebSocketSignaling {
    wsURL;
    wsConnection;
    logger;
    constructor(wsURL, logger) {
        this.wsURL = wsURL;
        this.wsConnection = new WebSocket(this.wsURL);
        this.wsConnection.addEventListener("message", (message) => (this.logger.debug(message.data)));
        this.logger = logger;
    }
    async connect(connected) {
        this.wsConnection.onopen = connected;
    }
    disconnect() {
        this.wsConnection.close();
    }
    send(data) {
        if (this.wsConnection.readyState != WebSocket.OPEN) {
            throw `Invalid State, WS Connection ${this.wsConnection.readyState.toString()}`;
        }
        this.wsConnection.send(data);
    }
    sendOffer(offer) {
        this.send(JSON.stringify(offer));
    }
    sendSignal(data) {
        this.send(data);
    }
    sendAudioData(audioData) {
        if (this.logger.getLevel() === Logger_1.LogLevel.DEBUG)
            this.logger.debug("Sent Audio of length: " + (audioData.length / 32000).toString());
        this.send(audioData);
    }
    sendAudioDataImmediate(audioData) {
        if (this.logger.getLevel() === Logger_1.LogLevel.DEBUG)
            this.logger.debug("Sent Audio of length for immediate playback: " + (audioData.length / 32000).toString());
        const asciiStr = "PLAY_IMMEDIATE";
        const encoder = new TextEncoder(); // Default is utf-8
        const strBytes = encoder.encode(asciiStr); // Uint8Array of " World!"
        const buffer = new Uint8Array(strBytes.length + audioData.length);
        buffer.set(strBytes, 0);
        buffer.set(audioData, strBytes.length);
        this.send(buffer);
    }
}
exports.WebSocketSignaling = WebSocketSignaling;

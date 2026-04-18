"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LivekitTransport = void 0;
const livekit_client_1 = require("livekit-client");
const WebSocketSignaling_1 = require("../signaling/WebSocketSignaling");
const BaseTransport_1 = require("./BaseTransport");
class LivekitTransport {
    videoElementAnchor;
    audioElementAnchor;
    signalingConnection;
    session_token;
    pc;
    logger;
    events = new Map();
    websocketPromise;
    websocketReject = null;
    constructor(simliBaseWSURL, session_token, videoElementAnchor, audioElementAnchor, logger, failSignal) {
        this.logger = logger;
        this.on("startup_error", failSignal);
        this.session_token = session_token;
        const wsURL = new URL(simliBaseWSURL + "/compose/webrtc/livekit");
        wsURL.searchParams.set("session_token", session_token);
        this.signalingConnection = new WebSocketSignaling_1.WebSocketSignaling(wsURL, this.logger);
        this.on("destination", (serilized_info) => (0, BaseTransport_1.register_destination)(this.logger, serilized_info));
        this.websocketPromise = new Promise((resolve, reject) => {
            this.websocketReject = reject;
            this.signalingConnection.connect(() => {
                resolve("success");
                this.logger.debug("LK WebSocket Connected");
            });
        });
        this.signalingConnection.wsConnection.onmessage = (message) => {
            (0, BaseTransport_1.handleMessage)(this, message);
        };
        this.signalingConnection.wsConnection.onerror = (evt) => {
            this.emit("startup_error", "Websocket Failed");
            if (this.websocketReject) {
                this.websocketReject("Websocket Failed");
                this.websocketReject = null; // Prevent multiple rejections
            }
        };
        const options = { adaptiveStream: true, dynacast: true };
        this.pc = new livekit_client_1.Room(options);
        this.on("connection_info", (serialized_info) => this.join_lk_room(serialized_info));
        this.videoElementAnchor = videoElementAnchor;
        this.audioElementAnchor = audioElementAnchor;
    }
    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event)?.add(callback);
        this.logger.debug("Registered Callback for Event: " + event);
    }
    off(event, callback) {
        if (!this.events.has(event)) {
            throw "Event Not Regsitered";
        }
        this.events.get(event)?.delete(callback);
    }
    emit(event, ...args) {
        this.logger.debug("Event: " + event);
        this.events.get(event)?.forEach((callback) => {
            callback(...args);
        });
    }
    async connect() {
        this.logger.info("Connecting");
        this.setupConnectionStateHandler();
        await this.websocketPromise;
    }
    async disconnect() {
        this.logger.info("Disconnecting");
        try {
            this.signalingConnection.sendSignal("DONE");
        }
        catch {
            this.logger.error("FAILED TO SEND FINAL MESSAGE");
        }
        try {
            this.signalingConnection.disconnect();
        }
        catch {
            this.logger.error("SIGNALING ALREADY DISCONNECTED");
        }
        try {
            await this.pc.disconnect();
        }
        catch {
            this.logger.error("LOCAL PEER ALREADY CLOSED");
        }
    }
    async join_lk_room(serialized_info) {
        const info = JSON.parse(serialized_info);
        this.logger.debug(info);
        if (info.livekit_url && info.livekit_token) {
            await this.pc.connect(info.livekit_url, info.livekit_token);
        }
        else {
            this.disconnect();
            this.emit("error", "Invalid Join Info, Contact Simli For Support");
        }
    }
    setupConnectionStateHandler() {
        this.pc.on(livekit_client_1.RoomEvent.Disconnected, () => {
            this.disconnect();
        });
        this.pc.on(livekit_client_1.RoomEvent.Connected, () => {
        });
        this.pc.on(livekit_client_1.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            this.logger.debug("Track Received: " + track.kind);
            if (track.kind === livekit_client_1.Track.Kind.Video) {
                track.attach(this.videoElementAnchor);
                this.videoElementAnchor.requestVideoFrameCallback(() => {
                    this.emit("start");
                });
            }
            else if (track.kind === livekit_client_1.Track.Kind.Audio) {
                track.attach(this.audioElementAnchor);
            }
        });
    }
    ;
}
exports.LivekitTransport = LivekitTransport;

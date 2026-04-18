"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.P2PTransport = void 0;
const WebSocketSignaling_1 = require("../signaling/WebSocketSignaling");
const BaseTransport_1 = require("./BaseTransport");
class P2PTransport {
    videoElementAnchor;
    audioElementAnchor;
    signalingConnection;
    session_token;
    pc;
    events = new Map();
    logger;
    iceCandidateCount;
    previousIceCandidateCount;
    iceTimeout = null;
    websocketPromise;
    websocketReject = null;
    constructor(simliBaseWSURL, session_token, enableSFU, iceServers, videoElementAnchor, audioElementAnchor, logger, failSignal) {
        this.logger = logger;
        this.on("startup_error", failSignal);
        this.session_token = session_token;
        const wsURL = new URL(simliBaseWSURL + "/compose/webrtc/p2p");
        wsURL.searchParams.set("session_token", session_token);
        wsURL.searchParams.set("enableSFU", String(enableSFU));
        this.on("destination", (serilized_info) => (0, BaseTransport_1.register_destination)(this.logger, serilized_info));
        this.signalingConnection = new WebSocketSignaling_1.WebSocketSignaling(wsURL, this.logger);
        this.websocketPromise = new Promise((resolve, reject) => {
            this.websocketReject = reject;
            this.signalingConnection.connect(() => {
                resolve("success");
                this.logger.debug("P2P WebSocket Connected");
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
        this.on("connection_info", (serialized_info) => this.registerPeerInfo(serialized_info));
        this.videoElementAnchor = videoElementAnchor;
        this.audioElementAnchor = audioElementAnchor;
        this.iceCandidateCount = 0;
        this.previousIceCandidateCount = 0;
        const config = {
            sdpSemantics: "unified-plan",
            iceServers: iceServers,
        };
        this.pc = new window.RTCPeerConnection(config);
        this.pc.addTransceiver("audio", {
            direction: "recvonly",
        });
        this.pc.addTransceiver("video", {
            direction: "recvonly",
        });
    }
    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event)?.add(callback);
    }
    off(event, callback) {
        this.events.get(event)?.delete(callback);
    }
    emit(event, ...args) {
        this.events.get(event)?.forEach((callback) => {
            try {
                callback(...args);
            }
            catch {
                this.logger.error("CALLBACK FAILED: " + callback.name);
            }
        });
    }
    async connect() {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        await this.waitForIceGathering();
        this.setupPeerConnectionListeners();
        await this.websocketPromise;
        if (this.pc.localDescription) {
            this.signalingConnection.sendOffer(this.pc.localDescription);
        }
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
            this.pc.close();
        }
        catch {
            this.logger.error("LOCAL PEER ALREADY CLOSED");
        }
    }
    async registerPeerInfo(serialized_info) {
        const info = JSON.parse(serialized_info);
        if (info.sdp && info.type == "answer") {
            await this.pc.setRemoteDescription(new RTCSessionDescription(info));
        }
        else {
            this.disconnect();
            this.emit("error", "Invalid Join Info, Contact Simli For Support");
        }
    }
    async waitForIceGathering() {
        this.iceCandidateCount = 0;
        this.previousIceCandidateCount = 0;
        if (this.pc.iceGatheringState === "complete") {
            return;
        }
        return new Promise((resolve, reject) => {
            if (!this.iceTimeout) {
                this.iceTimeout = setTimeout(() => {
                    reject(new Error("ICE gathering timeout"));
                }, 10000);
            }
            const checkIceCandidates = () => {
                if (this.pc.iceGatheringState === "complete" ||
                    this.iceCandidateCount === this.previousIceCandidateCount) {
                    if (this.iceTimeout) {
                        clearTimeout(this.iceTimeout);
                    }
                    resolve();
                }
                else {
                    this.previousIceCandidateCount = this.iceCandidateCount;
                    setTimeout(checkIceCandidates, 150);
                }
            };
            checkIceCandidates();
        });
    }
    setupPeerConnectionListeners() {
        this.pc.addEventListener("track", (evt) => {
            if (evt.track.kind === "video") {
                this.videoElementAnchor.srcObject = evt.streams[0];
                this.videoElementAnchor.requestVideoFrameCallback(() => {
                    this.emit("start");
                });
            }
            else if (evt.track.kind === "audio" && this.audioElementAnchor) {
                this.audioElementAnchor.srcObject = evt.streams[0];
            }
        });
        this.pc.onicecandidate = (event) => {
            if (event.candidate !== null) {
                this.iceCandidateCount += 1;
            }
        };
    }
}
exports.P2PTransport = P2PTransport;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimliClient = void 0;
const logger_1 = require("./utils/logger");
// src/index.ts
const AudioProcessor = `
        class AudioProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.buffer = new Int16Array(${3000});
            this.bufferIndex = 0;
        }

          process(inputs, outputs, parameters) {
            const input = inputs[0];
            const inputChannel = input[0];
            if (inputChannel) {
              for (let i = 0; i < inputChannel.length; i++) {
                this.buffer[this.bufferIndex] = Math.max(-32768, Math.min(32767, Math.round(inputChannel[i] * 32767)));
                this.bufferIndex++;
                
                if (this.bufferIndex === this.buffer.length){
                  this.port.postMessage({type: 'audioData', data: this.buffer.slice(0, this.bufferIndex)});
                  this.bufferIndex = 0;
                }
              }
            }
            return true;
          }
        }

        registerProcessor('audio-processor', AudioProcessor);
      `;
class SimliClient {
    constructor() {
        this.pc = null;
        this.dc = null;
        this.dcInterval = null;
        this.candidateCount = 0;
        this.prevCandidateCount = -1;
        this.avatarId = "";
        this.session_token = "";
        this.handleSilence = true;
        this.videoRef = null;
        this.audioRef = null;
        this.errorReason = null;
        this.sessionInitialized = false;
        this.inputStreamTrack = null;
        this.sourceNode = null;
        this.audioWorklet = null;
        this.audioBuffer = null;
        this.maxSessionLength = 3600;
        this.maxIdleTime = 600;
        this.pingSendTimes = new Map();
        this.webSocket = null;
        this.lastSendTime = 0;
        this.MAX_RETRY_ATTEMPTS = 3;
        this.RETRY_DELAY = 1500;
        this.connectionTimeout = null;
        this.CONNECTION_TIMEOUT_MS = 15000;
        this.SimliURL = "";
        this.isAvatarSpeaking = false;
        // Event handling
        this.events = new Map();
        this.ClearBuffer = () => {
            var _a;
            if (((_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN) {
                try {
                    this.webSocket.send("SKIP");
                }
                catch (error) {
                    logger_1.logger.error("Failed to clear buffer:", error);
                }
            }
            else {
                logger_1.logger.warn("Cannot clear buffer: WebSocket not open");
            }
        };
    }
    // Type-safe event methods
    on(event, callback) {
        var _a;
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        (_a = this.events.get(event)) === null || _a === void 0 ? void 0 : _a.add(callback);
    }
    off(event, callback) {
        var _a;
        (_a = this.events.get(event)) === null || _a === void 0 ? void 0 : _a.delete(callback);
    }
    emit(event, ...args) {
        var _a;
        (_a = this.events.get(event)) === null || _a === void 0 ? void 0 : _a.forEach(callback => {
            callback(...args);
        });
    }
    Initialize(config) {
        if (!config.avatarId || config.avatarId === "") {
            logger_1.logger.error("avatar id is required in config");
            throw new Error("avatar id is required in config");
        }
        this.avatarId = config.avatarId;
        this.handleSilence = config.handleSilence;
        this.maxSessionLength = config.maxSessionLength;
        this.maxIdleTime = config.maxIdleTime;
        if (!config.SimliURL || config.SimliURL === "") {
            this.SimliURL = "https://api.simli.ai";
        }
        else {
            this.SimliURL = config.SimliURL;
        }
        if (typeof window !== "undefined") {
            this.videoRef = config.videoRef;
            this.audioRef = config.audioRef;
            if (!(this.videoRef instanceof HTMLVideoElement)) {
                logger_1.logger.error("videoRef is required in config as HTMLVideoElement");
            }
            if (!(this.audioRef instanceof HTMLAudioElement)) {
                logger_1.logger.error("audioRef is required in config as HTMLAudioElement");
            }
            logger_1.logger.info("simli-client@1.2.8 initialized");
        }
        else {
            logger_1.logger.warn("Running in Node.js environment. Some features may not be available.");
        }
    }
    async getIceServers(attempt = 1) {
        try {
            const response = await Promise.race([
                fetch(`${this.SimliURL}/getIceServers`, {
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("ICE server request timeout")), 5000)),
            ]);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const iceServers = await response.json();
            if (!iceServers || iceServers.length === 0) {
                throw new Error("No ICE servers returned");
            }
            return iceServers;
        }
        catch (error) {
            logger_1.logger.warn(`ICE servers fetch attempt ${attempt} failed:`, error);
            if (attempt < this.MAX_RETRY_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                return this.getIceServers(attempt + 1);
            }
            logger_1.logger.info("Using fallback STUN server");
            return [{ urls: ["stun:stun.l.google.com:19302"] }];
        }
    }
    async createPeerConnection(iceServers = []) {
        const config = {
            sdpSemantics: "unified-plan",
            iceServers: iceServers,
        };
        logger_1.logger.info("Server running: ", config.iceServers);
        this.pc = new window.RTCPeerConnection(config);
        if (this.pc) {
            this.setupPeerConnectionListeners();
        }
    }
    setupPeerConnectionListeners() {
        if (!this.pc)
            return;
        this.pc.addEventListener("icegatheringstatechange", () => {
            var _a;
            logger_1.logger.info("ICE gathering state changed: ", (_a = this.pc) === null || _a === void 0 ? void 0 : _a.iceGatheringState);
        });
        this.pc.addEventListener("iceconnectionstatechange", () => {
            var _a, _b;
            logger_1.logger.info("ICE connection state changed: ", (_a = this.pc) === null || _a === void 0 ? void 0 : _a.iceConnectionState);
            if (((_b = this.pc) === null || _b === void 0 ? void 0 : _b.iceConnectionState) === "failed") {
                this.handleConnectionFailure("ICE connection failed").then().catch(logger_1.logger.error);
            }
        });
        this.pc.addEventListener("signalingstatechange", () => {
            var _a;
            logger_1.logger.info("Signaling state changed: ", (_a = this.pc) === null || _a === void 0 ? void 0 : _a.signalingState);
        });
        this.pc.addEventListener("track", (evt) => {
            logger_1.logger.info("Track event: ", evt.track.kind);
            if (evt.track.kind === "video" && this.videoRef) {
                this.videoRef.srcObject = evt.streams[0];
            }
            else if (evt.track.kind === "audio" && this.audioRef) {
                this.audioRef.srcObject = evt.streams[0];
            }
        });
        this.pc.onicecandidate = (event) => {
            if (event.candidate === null) {
                // logger.debug(JSON.stringify(this.pc?.localDescription));
            }
            else {
                // logger.debug(event.candidate);
                this.candidateCount += 1;
            }
        };
    }
    setupConnectionStateHandler() {
        if (!this.pc)
            return;
        this.pc.addEventListener("connectionstatechange", () => {
            var _a, _b;
            logger_1.logger.info("Connection state changed to:", (_a = this.pc) === null || _a === void 0 ? void 0 : _a.connectionState);
            switch ((_b = this.pc) === null || _b === void 0 ? void 0 : _b.connectionState) {
                case "connected":
                    this.clearTimeouts();
                    break;
                case "failed":
                case "closed":
                    this.emit("disconnected");
                    this.emit("failed", "Connection failed or closed");
                    this.cleanup();
                    break;
                case "disconnected":
                    this.emit("disconnected");
                    this.handleDisconnection();
                    break;
            }
        });
    }
    async start(iceServers = [], retryAttempt = 1) {
        var _a, _b;
        try {
            this.clearTimeouts();
            // Set overall connection timeout
            this.connectionTimeout = setTimeout(() => {
                this.handleConnectionTimeout().then().catch((error) => logger_1.logger.error(error));
            }, this.CONNECTION_TIMEOUT_MS);
            if (iceServers.length === 0) {
                iceServers = await this.getIceServers();
            }
            await this.createPeerConnection(iceServers);
            const parameters = { ordered: true };
            this.dc = this.pc.createDataChannel("chat", parameters);
            this.setupDataChannelListeners();
            this.setupConnectionStateHandler();
            (_a = this.pc) === null || _a === void 0 ? void 0 : _a.addTransceiver("audio", { direction: "recvonly" });
            (_b = this.pc) === null || _b === void 0 ? void 0 : _b.addTransceiver("video", { direction: "recvonly" });
            await this.negotiate();
            // Clear timeout if connection successful
            this.clearTimeouts();
        }
        catch (error) {
            logger_1.logger.error(`Connection attempt ${retryAttempt} failed:`, error);
            this.clearTimeouts();
            if (retryAttempt < this.MAX_RETRY_ATTEMPTS) {
                logger_1.logger.info(`Retrying connection... Attempt ${retryAttempt + 1}`);
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                await this.cleanup();
                return this.start(iceServers, retryAttempt + 1);
            }
            this.emit("failed", `Failed to connect after ${this.MAX_RETRY_ATTEMPTS} attempts`);
            throw error;
        }
    }
    setupDataChannelListeners() {
        if (!this.dc)
            return;
        this.dc.addEventListener("close", () => {
            logger_1.logger.info("Data channel closed");
            this.emit("disconnected");
            this.stopDataChannelInterval();
        });
        this.dc.addEventListener("error", (error) => {
            logger_1.logger.error("Data channel error:", error);
            this.emit("disconnected");
            this.handleConnectionFailure("Data channel error").then().catch(logger_1.logger.error);
        });
    }
    startDataChannelInterval() {
        this.stopDataChannelInterval(); // Clear any existing interval
        this.dcInterval = setInterval(() => {
            // this.sendPingMessage();
        }, 1000);
    }
    stopDataChannelInterval() {
        if (this.dcInterval) {
            clearInterval(this.dcInterval);
            this.dcInterval = null;
        }
    }
    async sendPingMessage() {
        var _a, _b;
        if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
            const message = "ping " + Date.now();
            this.pingSendTimes.set(message, Date.now());
            try {
                (_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.send(message);
            }
            catch (error) {
                logger_1.logger.error("Failed to send message:", error);
                this.stopDataChannelInterval();
                await this.handleConnectionFailure("Failed to send ping message");
            }
        }
        else {
            logger_1.logger.warn("WebSocket is not open. Current state:", (_b = this.webSocket) === null || _b === void 0 ? void 0 : _b.readyState);
            if (this.errorReason !== null) {
                logger_1.logger.error("Error Reason: ", this.errorReason);
            }
            this.stopDataChannelInterval();
        }
    }
    async createSessionToken(metadata) {
        try {
            const response = await fetch(`${this.SimliURL}/startAudioToVideoSession`, {
                method: "POST",
                body: JSON.stringify(metadata),
                headers: {
                    "Content-Type": "application/json",
                },
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`${errorText}`);
            }
            const resJSON = await response.json();
            return resJSON;
        }
        catch (error) {
            await this.handleConnectionFailure(`Session initialization failed: ${error}`);
            throw error;
        }
    }
    async sendSessionToken(sessionToken) {
        var _a;
        try {
            if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
                (_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.send(sessionToken);
            }
            else {
                throw new Error("WebSocket not open when trying to send session token");
            }
        }
        catch (error) {
            await this.handleConnectionFailure(`Session initialization failed: ${error}`);
            throw error;
        }
    }
    async negotiate() {
        if (!this.pc) {
            throw new Error("PeerConnection not initialized");
        }
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            await this.waitForIceGathering();
            const localDescription = this.pc.localDescription;
            if (!localDescription) {
                throw new Error("Local description is null");
            }
            const [protocol, baseUri] = this.getWebSocketUrl();
            const ws = new WebSocket(`${protocol}://${baseUri}/StartWebRTCSession`);
            this.webSocket = ws;
            this.setupWebSocketListeners(ws);
            let wsConnectResolve;
            const wsConnectPromise = new Promise((resolve) => {
                wsConnectResolve = resolve;
            });
            ws.addEventListener("open", async () => {
                var _a;
                ws.send(JSON.stringify((_a = this.pc) === null || _a === void 0 ? void 0 : _a.localDescription));
                const metadata = {
                    avatarId: this.avatarId,
                    isJPG: false,
                    syncAudio: true,
                    handleSilence: this.handleSilence,
                    maxSessionLength: this.maxSessionLength,
                    maxIdleTime: this.maxIdleTime,
                };
                if (!this.session_token || this.session_token === "") {
                    await this.sendSessionToken((await this.createSessionToken(metadata)).session_token);
                }
                else {
                    await this.sendSessionToken(this.session_token);
                }
                this.startDataChannelInterval();
                wsConnectResolve();
            });
            let answer = null;
            ws.addEventListener("message", async (evt) => {
                logger_1.logger.info("Received message: ", evt.data);
                try {
                    if (evt.data === "START") {
                        this.sessionInitialized = true;
                        this.sendAudioData(new Uint8Array(6000));
                        this.emit("connected");
                    }
                    else if (evt.data === "STOP") {
                        this.close();
                    }
                    else if (evt.data.startsWith("pong")) {
                        const pingTime = this.pingSendTimes.get(evt.data.replace("pong", "ping"));
                        if (pingTime) {
                            logger_1.logger.info("Simli Latency: ", Date.now() - pingTime);
                        }
                    }
                    else if (evt.data === "ACK") {
                        // logger.debug("Received ACK");
                    }
                    else if (evt.data === "SPEAK") {
                        this.emit("speaking");
                        this.isAvatarSpeaking = true;
                    }
                    else if (evt.data === "SILENT") {
                        this.emit("silent");
                        this.isAvatarSpeaking = false;
                    }
                    else {
                        const message = JSON.parse(evt.data);
                        if (message.type === "answer") {
                            answer = message;
                        }
                    }
                }
                catch (e) {
                    logger_1.logger.warn("Error processing WebSocket message:", e);
                }
            });
            ws.addEventListener("error", (error) => {
                logger_1.logger.error("WebSocket error:", error);
                this.handleConnectionFailure("WebSocket error");
            });
            ws.addEventListener("close", () => {
                logger_1.logger.warn("WebSocket closed");
            });
            // Wait for WebSocket connection
            await Promise.race([
                wsConnectPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000)),
            ]);
            // Wait for answer with timeout
            let timeoutId;
            await Promise.race([
                new Promise((resolve, reject) => {
                    timeoutId = setTimeout(() => reject(new Error("Answer timeout")), 10000);
                    const checkAnswer = async () => {
                        if (answer) {
                            await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
                            clearTimeout(timeoutId);
                            resolve();
                        }
                        else {
                            setTimeout(checkAnswer, 100);
                        }
                    };
                    checkAnswer();
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Answer timeout")), 10000)),
            ]);
        }
        catch (error) {
            await this.handleConnectionFailure(`Negotiation failed: ${error}`);
            throw error;
        }
    }
    async waitForIceGathering() {
        if (!this.pc)
            return;
        if (this.pc.iceGatheringState === "complete") {
            return;
        }
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("ICE gathering timeout"));
            }, 10000);
            const checkIceCandidates = () => {
                var _a;
                if (((_a = this.pc) === null || _a === void 0 ? void 0 : _a.iceGatheringState) === "complete" ||
                    this.candidateCount === this.prevCandidateCount) {
                    clearTimeout(timeout);
                    resolve();
                }
                else {
                    this.prevCandidateCount = this.candidateCount;
                    setTimeout(checkIceCandidates, 250);
                }
            };
            checkIceCandidates();
        });
    }
    async handleConnectionFailure(reason) {
        this.errorReason = reason;
        logger_1.logger.error("connection failure:", reason);
        this.emit("failed", reason);
        await this.cleanup();
    }
    async handleConnectionTimeout() {
        await this.handleConnectionFailure("Connection timed out");
    }
    handleDisconnection() {
        if (this.sessionInitialized) {
            logger_1.logger.info("Connection lost, attempting to reconnect...");
            this.cleanup()
                .then(() => this.start())
                .catch(error => {
                logger_1.logger.error("Reconnection failed:", error);
                this.emit("failed", "Reconnection failed");
            });
        }
    }
    async cleanup() {
        this.clearTimeouts();
        this.stopDataChannelInterval();
        this.events.clear();
        if (this.webSocket) {
            this.webSocket.close();
            this.webSocket = null;
        }
        if (this.dc) {
            this.dc.close();
            this.dc = null;
        }
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        if (this.audioWorklet) {
            this.audioWorklet.disconnect();
            this.audioWorklet = null;
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        this.sessionInitialized = false;
        this.candidateCount = 0;
        this.prevCandidateCount = -1;
        this.errorReason = null;
    }
    clearTimeouts() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }
    listenToMediastreamTrack(stream) {
        try {
            this.inputStreamTrack = stream;
            const audioContext = new (window.AudioContext ||
                window.webkitAudioContext)({
                sampleRate: 16000,
            });
            this.initializeAudioWorklet(audioContext, stream);
        }
        catch (error) {
            logger_1.logger.error("Failed to initialize audio stream:", error);
            this.emit("failed", "Audio initialization failed");
        }
    }
    initializeAudioWorklet(audioContext, stream) {
        audioContext.audioWorklet
            .addModule(URL.createObjectURL(new Blob([AudioProcessor], { type: "application/javascript" })))
            .then(() => {
            this.audioWorklet = new AudioWorkletNode(audioContext, "audio-processor");
            this.sourceNode = audioContext.createMediaStreamSource(new MediaStream([stream]));
            if (this.audioWorklet === null) {
                throw new Error("AudioWorklet not initialized");
            }
            this.sourceNode.connect(this.audioWorklet);
            this.audioWorklet.port.onmessage = async (event) => {
                if (event.data.type === "audioData") {
                    await this.sendAudioData(new Uint8Array(event.data.data.buffer));
                }
            };
        })
            .catch(error => {
            logger_1.logger.error("Failed to initialize AudioWorklet:", error);
            this.emit("failed", "AudioWorklet initialization failed");
        });
    }
    async sendAudioData(audioData) {
        var _a, _b;
        if (!this.sessionInitialized) {
            logger_1.logger.info("Session not initialized. Ignoring audio data.");
            return;
        }
        if (((_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.readyState) !== WebSocket.OPEN) {
            logger_1.logger.error("WebSocket is not open. Current state:", (_b = this.webSocket) === null || _b === void 0 ? void 0 : _b.readyState, "Error Reason:", this.errorReason);
            return;
        }
        try {
            this.webSocket.send(audioData);
            const currentTime = Date.now();
            if (this.lastSendTime !== 0) {
                const timeBetweenSends = currentTime - this.lastSendTime;
                if (timeBetweenSends > 100) { // Log only if significant delay
                    logger_1.logger.info("Time between sends:", timeBetweenSends);
                }
            }
            this.lastSendTime = currentTime;
        }
        catch (error) {
            logger_1.logger.error("Failed to send audio data:", error);
            await this.handleConnectionFailure("Failed to send audio data");
        }
    }
    async close() {
        logger_1.logger.info("Closing SimliClient connection");
        this.emit("disconnected");
        try {
            await this.cleanup();
        }
        catch (error) {
            logger_1.logger.error("Error during cleanup:", error);
        }
    }
    // Utility method to check connection status
    isConnected() {
        var _a, _b;
        return (this.sessionInitialized &&
            ((_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN &&
            ((_b = this.pc) === null || _b === void 0 ? void 0 : _b.connectionState) === "connected");
    }
    // Method to get current connection status details
    getConnectionStatus() {
        var _a, _b, _c, _d;
        return {
            sessionInitialized: this.sessionInitialized,
            webSocketState: (_b = (_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.readyState) !== null && _b !== void 0 ? _b : null,
            peerConnectionState: (_d = (_c = this.pc) === null || _c === void 0 ? void 0 : _c.connectionState) !== null && _d !== void 0 ? _d : null,
            errorReason: this.errorReason,
        };
    }
    setupWebSocketListeners(ws) {
        ws.addEventListener("error", (error) => {
            logger_1.logger.error("WebSocket error:", error);
            this.emit("disconnected");
            this.handleConnectionFailure("WebSocket error").then().catch((error) => logger_1.logger.error(error));
        });
        ws.addEventListener("close", () => {
            logger_1.logger.warn("WebSocket closed");
            this.emit("disconnected");
        });
    }
    getWebSocketUrl() {
        let url = this.SimliURL;
        const parsedUrl = new URL(url);
        const baseUri = parsedUrl.host + parsedUrl.pathname;
        const protocol = url.startsWith('https') ? 'wss' : 'ws';
        return [protocol, baseUri];
    }
}
exports.SimliClient = SimliClient;

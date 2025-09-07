"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimliClient = void 0;
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
        this.handleSilence = true;
        this.videoRef = null;
        this.audioRef = null;
        this.errorReason = null;
        this.sessionInitialized = false;
        this.inputStreamTrack = null;
        this.sourceNode = null;
        this.audioWorklet = null;
        this.audioBuffer = null;
        this.answer = null;
        this.localDescription = null;
        this.maxSessionLength = 3600;
        this.maxIdleTime = 600;
        this.model = "artalk";
        this.pingSendTimes = new Map();
        this.webSocket = null;
        this.lastSendTime = 0;
        this.MAX_RETRY_ATTEMPTS = 100;
        this.RETRY_DELAY = 500;
        this.connectionTimeout = null;
        this.CONNECTION_TIMEOUT_MS = 15000;
        this.SimliURL = "";
        this.isAvatarSpeaking = false;
        this.enableConsoleLogs = false;
        // Event handling
        this.events = new Map();
        this.retryAttempt = 1;
        this.inputIceServers = [];
        this.ClearBuffer = () => {
            var _a;
            if (((_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN) {
                try {
                    this.webSocket.send("SKIP");
                }
                catch (error) {
                    if (this.enableConsoleLogs)
                        console.error("SIMLI: Failed to clear buffer:", error);
                }
            }
            else {
                if (this.enableConsoleLogs)
                    console.warn("SIMLI: Cannot clear buffer: WebSocket not open");
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
        var _a, _b, _c;
        this.apiKey = config.apiKey;
        this.handleSilence = config.handleSilence;
        this.maxSessionLength = config.maxSessionLength;
        this.maxIdleTime = config.maxIdleTime;
        this.enableConsoleLogs = (_a = config.enableConsoleLogs) !== null && _a !== void 0 ? _a : false;
        this.session_token = config.session_token;
        this.token = config.token;
        this.ticket = config.ticket;
        this.MAX_RETRY_ATTEMPTS = (_b = config.maxRetryAttempts) !== null && _b !== void 0 ? _b : 100;
        this.RETRY_DELAY = (_c = config.retryDelay_ms) !== null && _c !== void 0 ? _c : 500;
        if (config.model) {
            this.model = config.model;
        }
        this.SimliURL = config.SimliURL || "https://api.simli.ai";
        if (typeof window !== "undefined") {
            this.videoRef = config.videoRef;
            this.audioRef = config.audioRef;
            if (!(this.videoRef instanceof HTMLVideoElement)) {
                console.error("SIMLI: videoRef is required in config as HTMLVideoElement");
            }
            if (!(this.audioRef instanceof HTMLAudioElement)) {
                console.error("SIMLI: audioRef is required in config as HTMLAudioElement");
            }
            console.log("SIMLI: simli-client@1.2.13 initialized");
        }
        else {
            console.warn("SIMLI: Running in Node.js environment. Some features may not be available.");
        }
    }
    async getIceServers(apiKey, attempt = 1) {
        try {
            const url = `${this.SimliURL}/getIceServers`;
            const response = await Promise.race([
                fetch(url, {
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                    body: JSON.stringify({ apiKey: apiKey }),
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("SIMLI: ICE server request timeout")), 5000)),
            ]);
            if (!response.ok) {
                throw new Error(`SIMLI: HTTP error! status: ${response.status}`);
            }
            const iceServers = await response.json();
            if (!iceServers || iceServers.length === 0) {
                throw new Error("SIMLI: No ICE servers returned");
            }
            return iceServers;
        }
        catch (error) {
            if (this.enableConsoleLogs)
                console.warn(`SIMLI: ICE servers fetch attempt ${attempt} failed:`, error);
            if (attempt < this.MAX_RETRY_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                return this.getIceServers(apiKey, attempt + 1);
            }
            if (this.enableConsoleLogs)
                console.log("SIMLI: Using fallback STUN server");
            return [{ urls: ["stun:stun.l.google.com:19302"] }];
        }
    }
    async createPeerConnection(iceServers = []) {
        if (this.pc) {
            this.pc.close();
        }
        const config = {
            sdpSemantics: "unified-plan",
            iceServers: iceServers,
        };
        if (this.enableConsoleLogs)
            console.log("SIMLI: Server running: ", config.iceServers);
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
            if (this.enableConsoleLogs)
                console.log("SIMLI: ICE gathering state changed: ", (_a = this.pc) === null || _a === void 0 ? void 0 : _a.iceGatheringState);
        });
        this.pc.addEventListener("iceconnectionstatechange", () => {
            var _a, _b;
            if (this.enableConsoleLogs)
                console.log("SIMLI: ICE connection state changed: ", (_a = this.pc) === null || _a === void 0 ? void 0 : _a.iceConnectionState);
            if (((_b = this.pc) === null || _b === void 0 ? void 0 : _b.iceConnectionState) === "failed") {
                if (this.retryAttempt < this.MAX_RETRY_ATTEMPTS) {
                    this.retryAttempt += 1;
                    this.start(this.inputIceServers, this.retryAttempt);
                }
                else {
                    this.handleConnectionFailure("ICE connection failed");
                }
            }
        });
        this.pc.addEventListener("signalingstatechange", () => {
            var _a;
            if (this.enableConsoleLogs)
                console.log("SIMLI: Signaling state changed: ", (_a = this.pc) === null || _a === void 0 ? void 0 : _a.signalingState);
        });
        this.pc.addEventListener("track", (evt) => {
            if (this.enableConsoleLogs)
                console.log("SIMLI: Track event: ", evt.track.kind);
            if (evt.track.kind === "video" && this.videoRef) {
                this.videoRef.srcObject = evt.streams[0];
            }
            else if (evt.track.kind === "audio" && this.audioRef) {
                this.audioRef.srcObject = evt.streams[0];
            }
        });
        this.pc.onicecandidate = (event) => {
            if (event.candidate === null) {
                // if (this.enableConsoleLogs) console.log(JSON.stringify(this.pc?.localDescription));
            }
            else {
                // if (this.enableConsoleLogs) console.log(event.candidate);
                this.candidateCount += 1;
            }
        };
    }
    setupConnectionStateHandler() {
        if (!this.pc)
            return;
        this.pc.addEventListener("connectionstatechange", () => {
            var _a, _b;
            if (this.enableConsoleLogs)
                console.log("SIMLI: Connection state changed to:", (_a = this.pc) === null || _a === void 0 ? void 0 : _a.connectionState);
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
                this.handleConnectionTimeout();
            }, this.CONNECTION_TIMEOUT_MS);
            this.inputIceServers = iceServers;
            if (iceServers.length === 0) {
                const metadata = {
                    isJPG: false,
                    apiKey: this.apiKey,
                    syncAudio: true,
                    handleSilence: this.handleSilence,
                    maxSessionLength: this.maxSessionLength,
                    maxIdleTime: this.maxIdleTime,
                    model: this.model
                };
                // Get All POST request related data at the same time
                const sessionRunData = await Promise.all([this.getIceServers(this.apiKey), this.createSessionToken(metadata),
                ]);
                iceServers = sessionRunData[0];
                this.session_token = sessionRunData[1].session_token;
            }
            let parameter = "";
            if (this.ticket)
                parameter = `?token=${this.ticket}`;
            const ws = new WebSocket(`${this.SimliURL.replace("http", "ws")}/StartWebRTCSession${parameter}`);
            this.webSocket = ws;
            const wsConnectPromise = new Promise((resolve) => {
                if (!this.webSocket) {
                    return;
                }
                this.setupWebSocketListeners(this.webSocket, resolve);
            });
            // Wait for WebSocket connection
            await Promise.race([
                wsConnectPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("SIMLI: WebSocket connection timeout")), 5000)),
            ]);
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
            if (this.enableConsoleLogs)
                console.error(`SIMLI: Connection attempt ${retryAttempt} failed:`, error);
            this.clearTimeouts();
            if (this.retryAttempt < this.MAX_RETRY_ATTEMPTS) {
                if (this.enableConsoleLogs)
                    console.log(`SIMLI: Retrying connection... Attempt ${retryAttempt + 1}`);
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                await this.cleanup();
                this.retryAttempt += 1;
                return this.start(iceServers, this.retryAttempt);
            }
            this.emit("failed", `Failed to connect after ${this.MAX_RETRY_ATTEMPTS} attempts`);
            throw error;
        }
    }
    setupDataChannelListeners() {
        if (!this.dc)
            return;
        this.dc.addEventListener("close", () => {
            if (this.enableConsoleLogs)
                console.log("SIMLI: Data channel closed");
            this.emit("disconnected");
            this.stopDataChannelInterval();
        });
        this.dc.addEventListener("error", (error) => {
            if (this.enableConsoleLogs)
                console.error("SIMLI: Data channel error:", error);
            this.emit("disconnected");
            this.handleConnectionFailure("Data channel error");
        });
    }
    startDataChannelInterval() {
        this.stopDataChannelInterval();
        this.dcInterval = setInterval(() => {
            this.sendPingMessage();
        }, 1000);
    }
    stopDataChannelInterval() {
        if (this.dcInterval) {
            clearInterval(this.dcInterval);
            this.dcInterval = null;
        }
    }
    sendPingMessage() {
        var _a, _b;
        if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
            const message = "ping " + Date.now();
            this.pingSendTimes.set(message, Date.now());
            try {
                (_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.send(message);
            }
            catch (error) {
                if (this.enableConsoleLogs)
                    console.error("SIMLI: Failed to send message:", error);
                this.stopDataChannelInterval();
                this.handleConnectionFailure("Failed to send ping message");
            }
        }
        else {
            if (this.enableConsoleLogs)
                console.warn("SIMLI: WebSocket is not open. Current state:", (_b = this.webSocket) === null || _b === void 0 ? void 0 : _b.readyState);
            if (this.errorReason !== null) {
                if (this.enableConsoleLogs)
                    console.error("SIMLI: Error Reason: ", this.errorReason);
            }
            this.stopDataChannelInterval();
        }
    }
    async createSessionToken(metadata) {
        if (this.session_token) {
            return { session_token: this.session_token };
        }
        try {
            const url = `${this.SimliURL}/startAudioToVideoSession`;
            const response = await fetch(url, {
                method: "POST",
                body: JSON.stringify(metadata),
                headers: {
                    "Content-Type": "application/json",
                    ...(this.token && { "Authorization": `Bearer ${this.token}` }),
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
            this.handleConnectionFailure(`Session initialization failed: ${error}`);
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
            this.handleConnectionFailure(`Session initialization failed: ${error}`);
            throw error;
        }
    }
    async negotiate() {
        if (!this.pc) {
            throw new Error("SIMLI: PeerConnection not initialized");
        }
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            await this.waitForIceGathering();
            this.localDescription = this.pc.localDescription;
            if (!this.localDescription) {
                throw new Error("SIMLI: Local description is null");
            }
            // Wait for answer with timeout
            let timeoutId;
            await Promise.race([
                new Promise((resolve, reject) => {
                    timeoutId = setTimeout(() => reject(new Error("Answer timeout")), 10000);
                    const checkAnswer = async () => {
                        if (this.answer) {
                            await this.pc.setRemoteDescription(new RTCSessionDescription(this.answer));
                            clearTimeout(timeoutId);
                            resolve();
                        }
                        else {
                            setTimeout(checkAnswer, 100);
                        }
                    };
                    checkAnswer();
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("SIMLI: Answer timeout")), 10000)),
            ]);
        }
        catch (error) {
            this.handleConnectionFailure(`SIMLI: Negotiation failed: ${error}`);
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
                    setTimeout(checkIceCandidates, 150);
                }
            };
            checkIceCandidates();
        });
    }
    handleConnectionFailure(reason) {
        this.errorReason = reason;
        if (this.enableConsoleLogs)
            console.error("SIMLI: connection failure:", reason);
        this.emit("failed", reason);
        this.cleanup();
    }
    handleConnectionTimeout() {
        this.handleConnectionFailure("Connection timed out");
    }
    handleDisconnection() {
        if (this.sessionInitialized) {
            if (this.enableConsoleLogs)
                console.log("SIMLI: Connection lost, attempting to reconnect...");
            this.cleanup()
                .then(() => this.start())
                .catch(error => {
                if (this.enableConsoleLogs)
                    console.error("SIMLI: Reconnection failed:", error);
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
            if (this.enableConsoleLogs)
                console.error("SIMLI: Failed to initialize audio stream:", error);
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
                throw new Error("SIMLI: AudioWorklet not initialized");
            }
            this.sourceNode.connect(this.audioWorklet);
            this.audioWorklet.port.onmessage = (event) => {
                if (event.data.type === "audioData") {
                    this.sendAudioData(new Uint8Array(event.data.data.buffer));
                }
            };
        })
            .catch(error => {
            if (this.enableConsoleLogs)
                console.error("SIMLI: Failed to initialize AudioWorklet:", error);
            this.emit("failed", "AudioWorklet initialization failed");
        });
    }
    sendAudioData(audioData) {
        var _a, _b;
        if (!this.sessionInitialized) {
            if (this.enableConsoleLogs)
                console.log("SIMLI: Session not initialized. Ignoring audio data.");
            return;
        }
        if (((_a = this.webSocket) === null || _a === void 0 ? void 0 : _a.readyState) !== WebSocket.OPEN) {
            if (this.enableConsoleLogs)
                console.error("SIMLI: WebSocket is not open. Current state:", (_b = this.webSocket) === null || _b === void 0 ? void 0 : _b.readyState, "Error Reason:", this.errorReason);
            return;
        }
        try {
            this.webSocket.send(audioData);
            const currentTime = Date.now();
            if (this.lastSendTime !== 0) {
                const timeBetweenSends = currentTime - this.lastSendTime;
                if (timeBetweenSends > 100) { // Log only if significant delay
                    if (this.enableConsoleLogs)
                        console.log("SIMLI: Time between sends:", timeBetweenSends);
                }
            }
            this.lastSendTime = currentTime;
        }
        catch (error) {
            if (this.enableConsoleLogs)
                console.error("SIMLI: Failed to send audio data:", error);
            this.handleConnectionFailure("Failed to send audio data");
        }
    }
    close() {
        if (this.enableConsoleLogs)
            console.log("SIMLI: Closing SimliClient connection");
        this.emit("disconnected");
        try {
            this.cleanup();
        }
        catch (error) {
            if (this.enableConsoleLogs)
                console.error("SIMLI: Error during cleanup:", error);
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
    setupWebSocketListeners(ws, wsConnectResolve) {
        ws.addEventListener("open", async () => {
            wsConnectResolve();
            while (!this.localDescription) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            ws.send(JSON.stringify(this.localDescription));
            const metadata = {
                isJPG: false,
                apiKey: this.apiKey,
                syncAudio: true,
                handleSilence: this.handleSilence,
                maxSessionLength: this.maxSessionLength,
                maxIdleTime: this.maxIdleTime,
                model: this.model,
            };
            if (!this.session_token) {
                await this.sendSessionToken((await this.createSessionToken(metadata)).session_token);
            }
            else {
                await this.sendSessionToken(this.session_token);
            }
            this.startDataChannelInterval();
        });
        ws.addEventListener("message", async (evt) => {
            if (this.enableConsoleLogs)
                console.log("SIMLI: Received message: ", evt.data);
            try {
                if (evt.data === "START") {
                    this.sessionInitialized = true;
                    this.sendAudioData(new Uint8Array(6000));
                    this.emit("connected");
                    console.log("START");
                    console.log(new Date().getTime());
                }
                else if (evt.data === "STOP") {
                    this.close();
                }
                else if (evt.data.startsWith("pong")) {
                    const pingTime = this.pingSendTimes.get(evt.data.replace("pong", "ping"));
                    if (pingTime) {
                        if (this.enableConsoleLogs)
                            console.log("SIMLI: Simli Latency: ", Date.now() - pingTime);
                    }
                }
                else if (evt.data === "ACK") {
                    // if (this.enableConsoleLogs) console.log("SIMLI: Received ACK");
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
                        this.answer = message;
                    }
                }
            }
            catch (e) {
                if (this.enableConsoleLogs)
                    console.warn("SIMLI: Error processing WebSocket message:", e);
            }
        });
        ws.addEventListener("error", (error) => {
            if (this.enableConsoleLogs)
                console.error("SIMLI: WebSocket error:", error);
            this.emit("disconnected");
            this.handleConnectionFailure("WebSocket error");
        });
        ws.addEventListener("close", () => {
            if (this.enableConsoleLogs)
                console.warn("SIMLI: WebSocket closed");
            this.emit("disconnected");
        });
    }
}
exports.SimliClient = SimliClient;

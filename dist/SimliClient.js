"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimliClient = void 0;
// src/index.ts
const livekit_client_1 = require("livekit-client");
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
        this.model = "fasttalk";
        this.webSocket = null;
        this.lastSendTime = 0;
        this.MAX_RETRY_ATTEMPTS = 100;
        this.RETRY_DELAY = 2000;
        this.connectionTimeout = null;
        this.CONNECTION_TIMEOUT_MS = 15000;
        this.isAvatarSpeaking = false;
        this.enableConsoleLogs = false;
        // Event handling
        this.events = new Map();
        this.retryAttempt = 1;
        this.inputIceServers = [];
        this.videoReceived = false;
        this.config = null;
        this.SimliURL = "";
        this.SimliWSURL = null;
        this.audioContext = null;
        this.start_stamp = 0;
        this.ClearBuffer = () => {
            if (this.webSocket?.readyState === WebSocket.OPEN) {
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
            callback(...args);
        });
    }
    Initialize(config) {
        this.apiKey = config.apiKey;
        this.handleSilence = config.handleSilence;
        this.maxSessionLength = config.maxSessionLength;
        this.maxIdleTime = config.maxIdleTime;
        this.enableConsoleLogs = config.enableConsoleLogs ?? false;
        this.session_token = config.session_token;
        this.token = config.token;
        this.ticket = config.ticket;
        this.handleSilence = config.handleSilence;
        this.maxSessionLength = config.maxSessionLength;
        this.maxIdleTime = config.maxIdleTime;
        this.enableConsoleLogs = config.enableConsoleLogs ?? false;
        this.session_token = config.session_token;
        this.MAX_RETRY_ATTEMPTS =
            config.maxRetryAttempts ?? this.MAX_RETRY_ATTEMPTS;
        this.RETRY_DELAY = config.retryDelay_ms ?? this.RETRY_DELAY;
        if (config.model) {
            this.model = config.model;
        }
        this.SimliURL = config.SimliURL || "https://api.simli.ai";
        this.SimliWSURL = this.SimliURL.replace("http", "ws");
        if (typeof window !== "undefined") {
            this.videoRef = config.videoRef;
            this.audioRef = config.audioRef;
            if (!(this.videoRef instanceof HTMLVideoElement)) {
                console.error("SIMLI: videoRef is required in config as HTMLVideoElement");
            }
            if (!(this.audioRef instanceof HTMLAudioElement)) {
                console.error("SIMLI: audioRef is required in config as HTMLAudioElement");
            }
            console.log("SIMLI: simli-client@2.0.0 initialized");
        }
        else {
            console.warn("SIMLI: Running in Node.js environment. Some features may not be available.");
        }
    }
    setupConnectionStateHandler(connectionSuccessResolve) {
        if (!this.pc)
            return;
        this.pc.on(livekit_client_1.RoomEvent.Disconnected, () => {
            if (this.videoReceived) {
                this.emit("disconnected");
                this.handleDisconnection();
            }
        });
        this.pc.on(livekit_client_1.RoomEvent.Connected, () => {
            this.emit("connected");
            this.clearTimeouts();
        });
        this.pc.on(livekit_client_1.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === livekit_client_1.Track.Kind.Video && this.videoRef) {
                track.attach(this.videoRef);
                this.videoRef.requestVideoFrameCallback(() => {
                    console.log("Connection Time:", new Date().getTime() - this.start_stamp);
                    connectionSuccessResolve();
                });
            }
            else if (track.kind === livekit_client_1.Track.Kind.Audio && this.audioRef) {
                track.attach(this.audioRef);
            }
        });
    }
    ;
    async start(retryAttempt = 0) {
        try {
            this.start_stamp = new Date().getTime();
            await this.cleanup();
            if (this.config) {
                this.Initialize(this.config);
            }
            this.clearTimeouts();
            // Set overall connection timeout
            if (!this.session_token) {
                const metadata = {
                    isJPG: false,
                    apiKey: this.apiKey,
                    syncAudio: true,
                    handleSilence: this.handleSilence,
                    maxSessionLength: this.maxSessionLength,
                    maxIdleTime: this.maxIdleTime,
                    model: this.model,
                };
                const sessionRunData = await this.createSessionToken(this.SimliURL, metadata);
                this.session_token = sessionRunData.session_token;
            }
            let parameter = "";
            if (this.ticket)
                parameter = `?token=${this.ticket}`;
            const url = `${this.SimliWSURL}/StartWebRTCSessionLivekit`;
            const ws = new WebSocket(url + parameter);
            this.webSocket = ws;
            const wsConnectPromise = new Promise((resolve, reject) => {
                if (this.webSocket) {
                    this.setupWebSocketListeners(this.webSocket, resolve);
                }
                this.connectionTimeout = setTimeout(() => {
                    this.handleConnectionTimeout(reject);
                }, this.CONNECTION_TIMEOUT_MS);
            });
            await Promise.race([
                wsConnectPromise,
                this.connectionTimeout,
            ]);
            this.videoReceived = true;
            console.log("CONNECTED");
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
                await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));
                this.retryAttempt += 1;
                return this.start(this.retryAttempt);
            }
            this.emit("failed", `Failed to connect after ${this.MAX_RETRY_ATTEMPTS} attempts`);
            throw error;
        }
    }
    sendPingMessage() {
        if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
            const message = "ping " + Date.now();
            try {
                this.webSocket?.send(message);
            }
            catch (error) {
                if (this.enableConsoleLogs)
                    console.error("SIMLI: Failed to send message:", error);
                this.handleConnectionFailure("Failed to send ping message");
            }
        }
        else {
            if (this.enableConsoleLogs)
                console.warn("SIMLI: WebSocket is not open. Current state:", this.webSocket?.readyState);
            if (this.errorReason !== null) {
                if (this.enableConsoleLogs)
                    console.error("SIMLI: Error Reason: ", this.errorReason);
            }
        }
    }
    async createSessionToken(SimliURL, metadata) {
        if (this.session_token && this.session_token !== "") {
            return { session_token: this.session_token };
        }
        try {
            const url = `${SimliURL}/startAudioToVideoSession`;
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
        try {
            if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
                this.webSocket?.send(sessionToken);
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
    handleConnectionFailure(reason) {
        this.errorReason = reason;
        if (this.enableConsoleLogs)
            console.error("SIMLI: connection failure:", reason);
        if (this.retryAttempt >= this.MAX_RETRY_ATTEMPTS) {
            this.emit("failed", reason);
        }
        this.cleanup();
    }
    handleConnectionTimeout(reject) {
        this.handleConnectionFailure("Connection timed out");
        reject(new Error("Connection timed out"));
    }
    handleDisconnection() {
        if (!this.sessionInitialized) {
            if (this.enableConsoleLogs)
                console.log("SIMLI: Connection lost while being esablished, attempting to reconnect...");
            this.start(this.retryAttempt)
                .catch((error) => {
                if (this.enableConsoleLogs)
                    console.error("SIMLI: Reconnection failed:", error);
                if (this.retryAttempt >= this.MAX_RETRY_ATTEMPTS) {
                    this.emit("failed", "Reconnection failed");
                }
            });
        }
    }
    async cleanup() {
        if (this.videoRef)
            this.videoRef.srcObject = null;
        if (this.audioRef)
            this.audioRef.srcObject = null;
        if (this.webSocket) {
            this.webSocket.close();
            this.webSocket = null;
        }
        if (this.pc) {
            await this.pc.disconnect();
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
        // Event handling
        this.clearTimeouts();
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
            this.audioContext = new (window.AudioContext ||
                window.webkitAudioContext)({
                sampleRate: 16000,
            });
            this.initializeAudioWorklet(this.audioContext, stream);
        }
        catch (error) {
            if (this.enableConsoleLogs)
                console.error("SIMLI: Failed to initialize audio stream:", error);
            if (this.retryAttempt >= this.MAX_RETRY_ATTEMPTS) {
                this.emit("failed", "Audio initialization failed");
            }
        }
    }
    initializeAudioWorklet(audioContext, stream) {
        audioContext.audioWorklet
            .addModule(URL.createObjectURL(new Blob([AudioProcessor], {
            type: "application/javascript",
        })))
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
            .catch((error) => {
            if (this.enableConsoleLogs)
                console.error("SIMLI: Failed to initialize AudioWorklet:", error);
            if (this.retryAttempt >= this.MAX_RETRY_ATTEMPTS) {
                this.emit("failed", "AudioWorklet initialization failed");
            }
        });
    }
    sendAudioData(audioData) {
        if (!this.sessionInitialized) {
            if (this.enableConsoleLogs)
                console.log("SIMLI: Session not initialized. Ignoring audio data.");
            return;
        }
        if (this.webSocket?.readyState !== WebSocket.OPEN) {
            if (this.enableConsoleLogs)
                console.error("SIMLI: WebSocket is not open. Current state:", this.webSocket?.readyState, "Error Reason:", this.errorReason);
            return;
        }
        try {
            this.webSocket.send(audioData);
            const currentTime = Date.now();
            if (this.lastSendTime !== 0) {
                const timeBetweenSends = currentTime - this.lastSendTime;
                if (timeBetweenSends > 100) {
                    // Log only if significant delay
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
    sendAudioDataImmediate(audioData) {
        if (!this.sessionInitialized) {
            if (this.enableConsoleLogs)
                console.log("SIMLI: Session not initialized. Ignoring audio data.");
            return;
        }
        if (this.webSocket?.readyState !== WebSocket.OPEN) {
            if (this.enableConsoleLogs)
                console.error("SIMLI: WebSocket is not open. Current state:", this.webSocket?.readyState, "Error Reason:", this.errorReason);
            return;
        }
        try {
            const asciiStr = "PLAY_IMMEDIATE";
            const encoder = new TextEncoder(); // Default is utf-8
            const strBytes = encoder.encode(asciiStr); // Uint8Array of " World!"
            const buffer = new Uint8Array(strBytes.length + audioData.length);
            buffer.set(strBytes, 0);
            buffer.set(audioData, strBytes.length);
            this.webSocket.send(buffer);
            const currentTime = Date.now();
            if (this.lastSendTime !== 0) {
                const timeBetweenSends = currentTime - this.lastSendTime;
                if (timeBetweenSends > 100) {
                    // Log only if significant delay
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
        if (this.webSocket)
            this.webSocket.send("DONE");
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
        return (this.sessionInitialized &&
            this.webSocket?.readyState === WebSocket.OPEN &&
            this.pc?.state === livekit_client_1.ConnectionState.Connected);
    }
    // Method to get current connection status details
    getConnectionStatus() {
        return {
            sessionInitialized: this.sessionInitialized,
            webSocketState: this.webSocket?.readyState ?? null,
            peerConnectionState: this.pc?.state ?? null,
            errorReason: this.errorReason,
        };
    }
    setupWebSocketListeners(ws, connectionSuccessResolve) {
        ws.addEventListener("open", async () => {
            connectionSuccessResolve();
            if (!this.session_token) {
                const metadata = {
                    isJPG: false,
                    apiKey: this.apiKey,
                    syncAudio: true,
                    handleSilence: this.handleSilence,
                    maxSessionLength: this.maxSessionLength,
                    maxIdleTime: this.maxIdleTime,
                    model: this.model,
                };
                await this.sendSessionToken((await this.createSessionToken(this.SimliURL, metadata))
                    .session_token);
            }
            else {
                await this.sendSessionToken(this.session_token);
            }
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
                }
                else if (evt.data === "STOP") {
                    this.close();
                }
                else if (evt.data.startsWith("pong") || evt.data === "ACK") {
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
                else if (evt.data === "MISSING_SESSION_TOKEN") {
                    if (!this.session_token || this.session_token === "") {
                        const metadata = {
                            isJPG: false,
                            apiKey: this.apiKey,
                            syncAudio: true,
                            handleSilence: this.handleSilence,
                            maxSessionLength: this.maxSessionLength,
                            maxIdleTime: this.maxIdleTime,
                            model: this.model,
                        };
                        await this.sendSessionToken((await this.createSessionToken(this.SimliURL, metadata))
                            .session_token);
                    }
                    else {
                        await this.sendSessionToken(this.session_token);
                    }
                }
                else {
                    const message = JSON.parse(evt.data);
                    if (message.livekit_url) {
                        const options = { adaptiveStream: true, dynacast: true };
                        this.pc = new livekit_client_1.Room(options);
                        this.setupConnectionStateHandler(connectionSuccessResolve);
                        await this.pc.connect(message.livekit_url, message.livekit_token);
                    }
                }
            }
            catch (e) {
                if (this.enableConsoleLogs)
                    console.warn("SIMLI: Error processing WebSocket message:", e);
            }
        });
        ws.addEventListener("error", (error) => {
            if (!this.videoReceived) {
                if (this.enableConsoleLogs)
                    console.error("SIMLI: WebSocket error:", error);
                this.emit("disconnected");
                this.handleConnectionFailure("WebSocket error");
            }
            else {
                this.cleanup()
                    .then(() => this.start(this.retryAttempt))
                    .catch((error) => {
                    if (this.enableConsoleLogs)
                        console.error("SIMLI: Reconnection failed:", error);
                    if (this.retryAttempt >= this.MAX_RETRY_ATTEMPTS) {
                        this.emit("failed", "Reconnection failed");
                    }
                });
            }
        });
        ws.addEventListener("close", () => {
            if (this.enableConsoleLogs)
                console.warn("SIMLI: WebSocket closed");
            this.emit("disconnected");
        });
    }
}
exports.SimliClient = SimliClient;

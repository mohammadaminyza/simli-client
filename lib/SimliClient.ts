import {logger} from './utils/logger';

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
      `

// Custom event handler types
type EventCallback = (...args: any[]) => void;
type EventMap = Map<string, Set<EventCallback>>;

interface SimliClientConfig {
    avatarId: string;
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
    videoRef: HTMLVideoElement;
    audioRef: HTMLAudioElement;
    SimliURL: string | "";
}

interface SimliSessionRequest {
    avatarId: string;
    isJPG: boolean;
    syncAudio: boolean;
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
}

interface SimliSessionToken {
    session_token: string
}

interface SimliClientEvents {
    connected: () => void;
    disconnected: () => void;
    failed: (reason: string) => void;
    speaking: () => void;
    silent: () => void;
}

class SimliClient {
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private dcInterval: NodeJS.Timeout | null = null;
    private candidateCount: number = 0;
    private prevCandidateCount: number = -1;
    private avatarId: string = "";
    private session_token: string = "";
    private handleSilence: boolean = true;
    private videoRef: HTMLVideoElement | null = null;
    private audioRef: HTMLAudioElement | null = null;
    private errorReason: string | null = null;
    private sessionInitialized: boolean = false;
    private inputStreamTrack: MediaStreamTrack | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private audioWorklet: AudioWorkletNode | null = null;
    private audioBuffer: Int16Array | null = null;
    private maxSessionLength: number = 3600;
    private maxIdleTime: number = 600;
    private pingSendTimes: Map<string, number> = new Map();
    private webSocket: WebSocket | null = null;
    private lastSendTime: number = 0;
    private readonly MAX_RETRY_ATTEMPTS = 3;
    private readonly RETRY_DELAY = 1500;
    private connectionTimeout: NodeJS.Timeout | null = null;
    private readonly CONNECTION_TIMEOUT_MS = 15000;
    private SimliURL: string = "";
    public isAvatarSpeaking: boolean = false;

    // Event handling
    private events: EventMap = new Map();

    // Type-safe event methods
    public on<K extends keyof SimliClientEvents>(
        event: K,
        callback: SimliClientEvents[K]
    ): void {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event)?.add(callback as EventCallback);
    }

    public off<K extends keyof SimliClientEvents>(
        event: K,
        callback: SimliClientEvents[K]
    ): void {
        this.events.get(event)?.delete(callback as EventCallback);
    }

    private emit<K extends keyof SimliClientEvents>(
        event: K,
        ...args: Parameters<SimliClientEvents[K]>
    ): void {
        this.events.get(event)?.forEach(callback => {
            callback(...args);
        });
    }

    public Initialize(config: SimliClientConfig) {
        if (!config.avatarId || config.avatarId === "") {
            logger.error("avatar id is required in config");
            throw new Error("avatar id is required in config");
        }
        this.avatarId = config.avatarId;
        this.handleSilence = config.handleSilence;
        this.maxSessionLength = config.maxSessionLength;
        this.maxIdleTime = config.maxIdleTime;
        if (!config.SimliURL || config.SimliURL === "") {
            this.SimliURL = "https://api.simli.ai";
        } else {
            this.SimliURL = config.SimliURL;
        }
        if (typeof window !== "undefined") {
            this.videoRef = config.videoRef;
            this.audioRef = config.audioRef;
            if (!(this.videoRef instanceof HTMLVideoElement)) {
                logger.error("videoRef is required in config as HTMLVideoElement");
            }
            if (!(this.audioRef instanceof HTMLAudioElement)) {
                logger.error("audioRef is required in config as HTMLAudioElement");
            }
            logger.info("simli-client@1.2.8 initialized");
        } else {
            logger.warn("Running in Node.js environment. Some features may not be available.");
        }
    }

    public async getIceServers(attempt = 1): Promise<RTCIceServer[]> {
        try {
            const response: any = await Promise.race([
                fetch(`${this.SimliURL}/getIceServers`, {
                    headers: {"Content-Type": "application/json"},
                    method: "POST",
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("ICE server request timeout")), 5000)
                ),
            ]);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const iceServers = await response.json();
            if (!iceServers || iceServers.length === 0) {
                throw new Error("No ICE servers returned");
            }

            return iceServers;
        } catch (error) {
            logger.warn(`ICE servers fetch attempt ${attempt} failed:`, error);

            if (attempt < this.MAX_RETRY_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                return this.getIceServers(attempt + 1);
            }

            logger.info("Using fallback STUN server");
            return [{urls: ["stun:stun.l.google.com:19302"]}];
        }
    }

    private async createPeerConnection(iceServers: RTCIceServer[] = []) {
        const config = {
            sdpSemantics: "unified-plan",
            iceServers: iceServers,
        };
        logger.info("Server running: ", config.iceServers);

        this.pc = new window.RTCPeerConnection(config);

        if (this.pc) {
            this.setupPeerConnectionListeners();
        }
    }

    private setupPeerConnectionListeners() {
        if (!this.pc) return;

        this.pc.addEventListener("icegatheringstatechange", () => {
            logger.info("ICE gathering state changed: ", this.pc?.iceGatheringState);
        });

        this.pc.addEventListener("iceconnectionstatechange", () => {
            logger.info("ICE connection state changed: ", this.pc?.iceConnectionState);
            if (this.pc?.iceConnectionState === "failed") {
                this.handleConnectionFailure("ICE connection failed").then().catch(logger.error);
            }
        });

        this.pc.addEventListener("signalingstatechange", () => {
            logger.info("Signaling state changed: ", this.pc?.signalingState);
        });

        this.pc.addEventListener("track", (evt) => {
            logger.info("Track event: ", evt.track.kind);
            if (evt.track.kind === "video" && this.videoRef) {
                this.videoRef.srcObject = evt.streams[0];
            } else if (evt.track.kind === "audio" && this.audioRef) {
                this.audioRef.srcObject = evt.streams[0];
            }
        });

        this.pc.onicecandidate = (event) => {
            if (event.candidate === null) {
                // logger.debug(JSON.stringify(this.pc?.localDescription));
            } else {
                // logger.debug(event.candidate);
                this.candidateCount += 1;
            }
        };
    }

    private setupConnectionStateHandler() {
        if (!this.pc) return;

        this.pc.addEventListener("connectionstatechange", () => {
            logger.info("Connection state changed to:", this.pc?.connectionState);

            switch (this.pc?.connectionState) {
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

    async start(
        iceServers: RTCIceServer[] = [], retryAttempt = 1
    ): Promise<void> {
        try {
            this.clearTimeouts();

            // Set overall connection timeout
            this.connectionTimeout = setTimeout(() => {
                this.handleConnectionTimeout().then().catch((error) => logger.error(error));
            }, this.CONNECTION_TIMEOUT_MS);
            if (iceServers.length === 0) {
                iceServers = await this.getIceServers()
            }
            await this.createPeerConnection(iceServers);

            const parameters = {ordered: true};
            this.dc = this.pc!.createDataChannel("chat", parameters);

            this.setupDataChannelListeners();
            this.setupConnectionStateHandler();

            this.pc?.addTransceiver("audio", {direction: "recvonly"});
            this.pc?.addTransceiver("video", {direction: "recvonly"});

            await this.negotiate();

            // Clear timeout if connection successful
            this.clearTimeouts();

        } catch (error) {
            logger.error(`Connection attempt ${retryAttempt} failed:`, error);
            this.clearTimeouts();

            if (retryAttempt < this.MAX_RETRY_ATTEMPTS) {
                logger.info(`Retrying connection... Attempt ${retryAttempt + 1}`);
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                await this.cleanup();
                return this.start(iceServers, retryAttempt + 1);
            }

            this.emit("failed", `Failed to connect after ${this.MAX_RETRY_ATTEMPTS} attempts`);
            throw error;
        }
    }

    private setupDataChannelListeners() {
        if (!this.dc) return;

        this.dc.addEventListener("close", () => {
            logger.info("Data channel closed");
            this.emit("disconnected");
            this.stopDataChannelInterval();
        });

        this.dc.addEventListener("error", (error) => {
            logger.error("Data channel error:", error);
            this.emit("disconnected");
            this.handleConnectionFailure("Data channel error").then().catch(logger.error);
        });
    }

    private startDataChannelInterval() {
        this.stopDataChannelInterval(); // Clear any existing interval
        this.dcInterval = setInterval(() => {
            // this.sendPingMessage();
        }, 1000);
    }

    private stopDataChannelInterval() {
        if (this.dcInterval) {
            clearInterval(this.dcInterval);
            this.dcInterval = null;
        }
    }

    private async sendPingMessage() {
        if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
            const message = "ping " + Date.now();
            this.pingSendTimes.set(message, Date.now());
            try {
                this.webSocket?.send(message);
            } catch (error) {
                logger.error("Failed to send message:", error);
                this.stopDataChannelInterval();
                await this.handleConnectionFailure("Failed to send ping message");
            }
        } else {
            logger.warn(
                "WebSocket is not open. Current state:",
                this.webSocket?.readyState
            );
            if (this.errorReason !== null) {
                logger.error("Error Reason: ", this.errorReason);
            }
            this.stopDataChannelInterval();
        }
    }

    public async createSessionToken(metadata: SimliSessionRequest): Promise<SimliSessionToken> {
        try {
            const response = await fetch(
                `${this.SimliURL}/startAudioToVideoSession`,
                {
                    method: "POST",
                    body: JSON.stringify(metadata),
                    headers: {
                        "Content-Type": "application/json",
                    },
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`${errorText}`);
            }

            const resJSON = await response.json();
            return resJSON;
        } catch (error) {
            await this.handleConnectionFailure(`Session initialization failed: ${error}`);
            throw error;
        }
    }

    private async sendSessionToken(sessionToken: string) {
        try {
            if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
                this.webSocket?.send(sessionToken);
            } else {
                throw new Error("WebSocket not open when trying to send session token");
            }
        } catch (error) {
            await this.handleConnectionFailure(`Session initialization failed: ${error}`);
            throw error;
        }
    }

    private async negotiate() {
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

            let wsConnectResolve: () => void;
            const wsConnectPromise = new Promise<void>((resolve) => {
                wsConnectResolve = resolve;
            });

            ws.addEventListener("open", async () => {
                ws.send(JSON.stringify(this.pc?.localDescription));
                const metadata: SimliSessionRequest = {
                    avatarId: this.avatarId,
                    isJPG: false,
                    syncAudio: true,
                    handleSilence: this.handleSilence,
                    maxSessionLength: this.maxSessionLength,
                    maxIdleTime: this.maxIdleTime,
                };
                if (!this.session_token || this.session_token === "") {
                    await this.sendSessionToken((await this.createSessionToken(metadata)).session_token)
                } else {
                    await this.sendSessionToken(this.session_token);
                }
                this.startDataChannelInterval();
                wsConnectResolve();
            });

            let answer: RTCSessionDescriptionInit | null = null;

            ws.addEventListener("message", async (evt) => {
                logger.info("Received message: ", evt.data);
                try {
                    if (evt.data === "START") {
                        this.sessionInitialized = true;
                        this.sendAudioData(new Uint8Array(6000));
                        this.emit("connected");
                    } else if (evt.data === "STOP") {
                        this.close();
                    } else if (evt.data.startsWith("pong")) {
                        const pingTime = this.pingSendTimes.get(evt.data.replace("pong", "ping"));
                        if (pingTime) {
                            logger.info("Simli Latency: ", Date.now() - pingTime);
                        }
                    } else if (evt.data === "ACK") {
                        // logger.debug("Received ACK");
                    } else if (evt.data === "SPEAK") {
                        this.emit("speaking");
                        this.isAvatarSpeaking = true;
                    } else if (evt.data === "SILENT") {
                        this.emit("silent");
                        this.isAvatarSpeaking = false;
                    } else {
                        const message = JSON.parse(evt.data);
                        if (message.type === "answer") {
                            answer = message;
                        }
                    }
                } catch (e) {
                    logger.warn("Error processing WebSocket message:", e);
                }
            });

            ws.addEventListener("error", (error) => {
                logger.error("WebSocket error:", error);
                this.handleConnectionFailure("WebSocket error");
            });

            ws.addEventListener("close", () => {
                logger.warn("WebSocket closed");
            });

            // Wait for WebSocket connection
            await Promise.race([
                wsConnectPromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000)
                ),
            ]);

            // Wait for answer with timeout
            let timeoutId: NodeJS.Timeout;
            await Promise.race([
                new Promise<void>((resolve, reject) => {
                    timeoutId = setTimeout(() => reject(new Error("Answer timeout")), 10000);
                    const checkAnswer = async () => {
                        if (answer) {
                            await this.pc!.setRemoteDescription(new RTCSessionDescription(answer));
                            clearTimeout(timeoutId);
                            resolve();
                        } else {
                            setTimeout(checkAnswer, 100);
                        }
                    };
                    checkAnswer();
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Answer timeout")), 10000)
                ),
            ]);

        } catch (error) {
            await this.handleConnectionFailure(`Negotiation failed: ${error}`);
            throw error;
        }
    }

    private async waitForIceGathering(): Promise<void> {
        if (!this.pc) return;

        if (this.pc.iceGatheringState === "complete") {
            return;
        }

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("ICE gathering timeout"));
            }, 10000);

            const checkIceCandidates = () => {
                if (
                    this.pc?.iceGatheringState === "complete" ||
                    this.candidateCount === this.prevCandidateCount
                ) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    this.prevCandidateCount = this.candidateCount;
                    setTimeout(checkIceCandidates, 250);
                }
            };

            checkIceCandidates();
        });
    }

    private async handleConnectionFailure(reason: string) {
        this.errorReason = reason;
        logger.error("connection failure:", reason);
        this.emit("failed", reason);
        await this.cleanup();
    }

    private async handleConnectionTimeout() {
        await this.handleConnectionFailure("Connection timed out");
    }

    private handleDisconnection() {
        if (this.sessionInitialized) {
            logger.info("Connection lost, attempting to reconnect...");
            this.cleanup()
                .then(() => this.start())
                .catch(error => {
                    logger.error("Reconnection failed:", error);
                    this.emit("failed", "Reconnection failed");
                });
        }
    }

    private async cleanup() {
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

    private clearTimeouts() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }

    listenToMediastreamTrack(stream: MediaStreamTrack) {
        try {
            this.inputStreamTrack = stream;
            const audioContext: AudioContext = new (window.AudioContext ||
                (window as any).webkitAudioContext)({
                sampleRate: 16000,
            });
            this.initializeAudioWorklet(audioContext, stream);
        } catch (error) {
            logger.error("Failed to initialize audio stream:", error);
            this.emit("failed", "Audio initialization failed");
        }
    }

    private initializeAudioWorklet(
        audioContext: AudioContext,
        stream: MediaStreamTrack
    ) {
        audioContext.audioWorklet
            .addModule(
                URL.createObjectURL(
                    new Blob([AudioProcessor], {type: "application/javascript"})
                )
            )
            .then(() => {
                this.audioWorklet = new AudioWorkletNode(
                    audioContext,
                    "audio-processor"
                );
                this.sourceNode = audioContext.createMediaStreamSource(
                    new MediaStream([stream])
                );
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
                logger.error("Failed to initialize AudioWorklet:", error);
                this.emit("failed", "AudioWorklet initialization failed");
            });
    }

    async sendAudioData(audioData: Uint8Array) {
        if (!this.sessionInitialized) {
            logger.info("Session not initialized. Ignoring audio data.");
            return;
        }

        if (this.webSocket?.readyState !== WebSocket.OPEN) {
            logger.error(
                "WebSocket is not open. Current state:",
                this.webSocket?.readyState,
                "Error Reason:",
                this.errorReason
            );
            return;
        }

        try {
            this.webSocket.send(audioData);
            const currentTime = Date.now();
            if (this.lastSendTime !== 0) {
                const timeBetweenSends = currentTime - this.lastSendTime;
                if (timeBetweenSends > 100) { // Log only if significant delay
                    logger.info("Time between sends:", timeBetweenSends);
                }
            }
            this.lastSendTime = currentTime;
        } catch (error) {
            logger.error("Failed to send audio data:", error);
            await this.handleConnectionFailure("Failed to send audio data");
        }
    }

    async close() {
        logger.info("Closing SimliClient connection");
        this.emit("disconnected");

        try {
            await this.cleanup();
        } catch (error) {
            logger.error("Error during cleanup:", error);
        }
    }

    public ClearBuffer = () => {
        if (this.webSocket?.readyState === WebSocket.OPEN) {
            try {
                this.webSocket.send("SKIP");
            } catch (error) {
                logger.error("Failed to clear buffer:", error);
            }
        } else {
            logger.warn("Cannot clear buffer: WebSocket not open");
        }
    };

    // Utility method to check connection status
    public isConnected(): boolean {
        return (
            this.sessionInitialized &&
            this.webSocket?.readyState === WebSocket.OPEN &&
            this.pc?.connectionState === "connected"
        );
    }

    // Method to get current connection status details
    public getConnectionStatus(): {
        sessionInitialized: boolean;
        webSocketState: number | null;
        peerConnectionState: RTCPeerConnectionState | null;
        errorReason: string | null;
    } {
        return {
            sessionInitialized: this.sessionInitialized,
            webSocketState: this.webSocket?.readyState ?? null,
            peerConnectionState: this.pc?.connectionState ?? null,
            errorReason: this.errorReason,
        };
    }

    private setupWebSocketListeners(ws: WebSocket) {
        ws.addEventListener("error", (error) => {
            logger.error("WebSocket error:", error);
            this.emit("disconnected");
            this.handleConnectionFailure("WebSocket error").then().catch((error) => logger.error(error));
        });

        ws.addEventListener("close", () => {
            logger.warn("WebSocket closed");
            this.emit("disconnected");
        });
    }

    private getWebSocketUrl(): [string, string] {
        let url = this.SimliURL;
        const parsedUrl = new URL(url);
        const baseUri = parsedUrl.host + parsedUrl.pathname;
        const protocol = url.startsWith('https') ? 'wss' : 'ws';
        return [protocol, baseUri];
    }
}

export {SimliClient, SimliClientConfig, SimliClientEvents};
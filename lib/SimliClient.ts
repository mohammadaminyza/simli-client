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
    enableConsoleLogs?: boolean;
    SimliURL: string | "";
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
    public enableConsoleLogs: boolean = false;

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
        this.avatarId = config.avatarId;
        this.handleSilence = config.handleSilence;
        this.maxSessionLength = config.maxSessionLength;
        this.maxIdleTime = config.maxIdleTime;
        this.enableConsoleLogs = config.enableConsoleLogs ?? false;
        if (!config.SimliURL || config.SimliURL === "") {
            this.SimliURL = "s://api.simli.ai";
        } else {
            this.SimliURL = config.SimliURL;
        }
        if (typeof window !== "undefined") {
            this.videoRef = config.videoRef;
            this.audioRef = config.audioRef;
            if (!(this.videoRef instanceof HTMLVideoElement)) {
                console.error("SIMLI: videoRef is required in config as HTMLVideoElement");
            }
            if (!(this.audioRef instanceof HTMLAudioElement)) {
                console.error("SIMLI: audioRef is required in config as HTMLAudioElement");
            }
            console.log("SIMLI: simli-client@1.2.6 initialized");
        } else {
            console.warn(
                "SIMLI: Running in Node.js environment. Some features may not be available."
            );
        }
    }

    private async getIceServers(attempt = 1): Promise<RTCIceServer[]> {
        try {
            const response: any = await Promise.race([
                fetch(`${this.SimliURL}/getIceServers`, {
                    headers: {"Content-Type": "application/json"},
                    method: "POST",
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("SIMLI: ICE server request timeout")), 5000)
                ),
            ]);

            if (!response.ok) {
                throw new Error(`SIMLI: HTTP error! status: ${response.status}`);
            }

            const iceServers = await response.json();
            if (!iceServers || iceServers.length === 0) {
                throw new Error("SIMLI: No ICE servers returned");
            }

            return iceServers;
        } catch (error) {
            if (this.enableConsoleLogs) console.warn(`SIMLI: ICE servers fetch attempt ${attempt} failed:`, error);

            if (attempt < this.MAX_RETRY_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                return this.getIceServers(attempt + 1);
            }

            if (this.enableConsoleLogs) console.log("SIMLI: Using fallback STUN server");
            return [{urls: ["stun:stun.l.google.com:19302"]}];
        }
    }

    private async createPeerConnection() {
        const config = {
            sdpSemantics: "unified-plan",
            iceServers: await this.getIceServers(),
        };
        if (this.enableConsoleLogs) console.log("SIMLI: Server running: ", config.iceServers);

        this.pc = new window.RTCPeerConnection(config);

        if (this.pc) {
            this.setupPeerConnectionListeners();
        }
    }

    private setupPeerConnectionListeners() {
        if (!this.pc) return;

        this.pc.addEventListener("icegatheringstatechange", () => {
            if (this.enableConsoleLogs) console.log("SIMLI: ICE gathering state changed: ", this.pc?.iceGatheringState);
        });

        this.pc.addEventListener("iceconnectionstatechange", () => {
            if (this.enableConsoleLogs) console.log("SIMLI: ICE connection state changed: ", this.pc?.iceConnectionState);
            if (this.pc?.iceConnectionState === "failed") {
                this.handleConnectionFailure("ICE connection failed");
            }
        });

        this.pc.addEventListener("signalingstatechange", () => {
            if (this.enableConsoleLogs) console.log("SIMLI: Signaling state changed: ", this.pc?.signalingState);
        });

        this.pc.addEventListener("track", (evt) => {
            if (this.enableConsoleLogs) console.log("SIMLI: Track event: ", evt.track.kind);
            if (evt.track.kind === "video" && this.videoRef) {
                this.videoRef.srcObject = evt.streams[0];
            } else if (evt.track.kind === "audio" && this.audioRef) {
                this.audioRef.srcObject = evt.streams[0];
            }
        });

        this.pc.onicecandidate = (event) => {
            if (event.candidate === null) {
                // if (this.enableConsoleLogs) console.log(JSON.stringify(this.pc?.localDescription));
            } else {
                // if (this.enableConsoleLogs) console.log(event.candidate);
                this.candidateCount += 1;
            }
        };
    }

    private setupConnectionStateHandler() {
        if (!this.pc) return;

        this.pc.addEventListener("connectionstatechange", () => {
            switch (this.pc?.connectionState) {
                case "connected":
                    this.clearTimeouts();
                    break;
                case "failed":
                case "closed":
                    this.emit("failed", "Connection failed or closed");
                    this.cleanup();
                    break;
                case "disconnected":
                    this.handleDisconnection();
                    break;
            }
        });
    }

    async start(retryAttempt = 1): Promise<void> {
        try {
            this.clearTimeouts();

            // Set overall connection timeout
            this.connectionTimeout = setTimeout(() => {
                this.handleConnectionTimeout();
            }, this.CONNECTION_TIMEOUT_MS);

            await this.createPeerConnection();

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
            if (this.enableConsoleLogs) console.error(`SIMLI: Connection attempt ${retryAttempt} failed:`, error);
            this.clearTimeouts();

            if (retryAttempt < this.MAX_RETRY_ATTEMPTS) {
                if (this.enableConsoleLogs) console.log(`SIMLI: Retrying connection... Attempt ${retryAttempt + 1}`);
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                await this.cleanup();
                return this.start(retryAttempt + 1);
            }

            this.emit("failed", `Failed to connect after ${this.MAX_RETRY_ATTEMPTS} attempts`);
            throw error;
        }
    }

    private setupDataChannelListeners() {
        if (!this.dc) return;

        this.dc.addEventListener("close", () => {
            if (this.enableConsoleLogs) console.log("SIMLI: Data channel closed");
            this.emit("disconnected");
            this.stopDataChannelInterval();
        });

        this.dc.addEventListener("error", (error) => {
            if (this.enableConsoleLogs) console.error("SIMLI: Data channel error:", error);
            this.handleConnectionFailure("Data channel error");
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

    private sendPingMessage() {
        if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
            const message = "ping " + Date.now();
            this.pingSendTimes.set(message, Date.now());
            try {
                this.webSocket?.send(message);
            } catch (error) {
                if (this.enableConsoleLogs) console.error("SIMLI: Failed to send message:", error);
                this.stopDataChannelInterval();
                this.handleConnectionFailure("Failed to send ping message");
            }
        } else {
            if (this.enableConsoleLogs) console.warn(
                "SIMLI: WebSocket is not open. Current state:",
                this.webSocket?.readyState
            );
            if (this.errorReason !== null) {
                if (this.enableConsoleLogs) console.error("SIMLI: Error Reason: ", this.errorReason);
            }
            this.stopDataChannelInterval();
        }
    }

    private async initializeSession() {
        const metadata = {
            avatarId: this.avatarId,
            isJPG: false,
            syncAudio: true,
            handleSilence: this.handleSilence,
            maxSessionLength: this.maxSessionLength,
            maxIdleTime: this.maxIdleTime,
        };

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
            if (this.webSocket && this.webSocket.readyState === this.webSocket.OPEN) {
                this.webSocket?.send(resJSON.session_token);
            } else {
                throw new Error("WebSocket not open when trying to send session token");
            }
        } catch (error) {
            this.handleConnectionFailure(`Session initialization failed: ${error}`);
            throw error;
        }
    }

    private async negotiate() {
        if (!this.pc) {
            throw new Error("SIMLI: PeerConnection not initialized");
        }

        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);

            await this.waitForIceGathering();

            const localDescription = this.pc.localDescription;
            if (!localDescription) {
                throw new Error("SIMLI: Local description is null");
            }

            const [protocol, baseUri] = this.getWebSocketUrl();
            const ws = new WebSocket(`${protocol}://${baseUri}/StartWebRTCSession`);
            this.webSocket = ws;

            let wsConnectResolve: () => void;
            const wsConnectPromise = new Promise<void>((resolve) => {
                wsConnectResolve = resolve;
            });

            ws.addEventListener("open", async () => {
                ws.send(JSON.stringify(this.pc?.localDescription));
                await this.initializeSession();
                this.startDataChannelInterval();
                wsConnectResolve();
            });

            let answer: RTCSessionDescriptionInit | null = null;

            ws.addEventListener("message", async (evt) => {
                if (this.enableConsoleLogs) console.log("SIMLI: Received message: ", evt.data);
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
                            if (this.enableConsoleLogs) console.log("SIMLI: Simli Latency: ", Date.now() - pingTime);
                        }
                    } else if (evt.data === "ACK") {
                        // if (this.enableConsoleLogs) console.log("SIMLI: Received ACK");
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
                    if (this.enableConsoleLogs) console.warn("SIMLI: Error processing WebSocket message:", e);
                }
            });

            ws.addEventListener("error", (error) => {
                if (this.enableConsoleLogs) console.error("SIMLI: WebSocket error:", error);
                this.handleConnectionFailure("WebSocket error");
            });

            ws.addEventListener("close", () => {
                if (this.enableConsoleLogs) console.warn("SIMLI: WebSocket closed");
            });

            // Wait for WebSocket connection
            await Promise.race([
                wsConnectPromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("SIMLI: WebSocket connection timeout")), 5000)
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
                    setTimeout(() => reject(new Error("SIMLI: Answer timeout")), 10000)
                ),
            ]);

        } catch (error) {
            this.handleConnectionFailure(`SIMLI: Negotiation failed: ${error}`);
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

    private handleConnectionFailure(reason: string) {
        this.errorReason = reason;
        if (this.enableConsoleLogs) console.error("SIMLI: connection failure:", reason);
        this.emit("failed", reason);
        this.cleanup();
    }

    private handleConnectionTimeout() {
        this.handleConnectionFailure("Connection timed out");
    }

    private handleDisconnection() {
        if (this.sessionInitialized) {
            if (this.enableConsoleLogs) console.log("SIMLI: Connection lost, attempting to reconnect...");
            this.cleanup()
                .then(() => this.start())
                .catch(error => {
                    if (this.enableConsoleLogs) console.error("SIMLI: Reconnection failed:", error);
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
            if (this.enableConsoleLogs) console.error("SIMLI: Failed to initialize audio stream:", error);
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
                if (this.enableConsoleLogs) console.error("SIMLI: Failed to initialize AudioWorklet:", error);
                this.emit("failed", "AudioWorklet initialization failed");
            });
    }

    sendAudioData(audioData: Uint8Array) {
        if (!this.sessionInitialized) {
            if (this.enableConsoleLogs) console.log("SIMLI: Session not initialized. Ignoring audio data.");
            return;
        }

        if (this.webSocket?.readyState !== WebSocket.OPEN) {
            if (this.enableConsoleLogs) console.error(
                "SIMLI: WebSocket is not open. Current state:",
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
                    if (this.enableConsoleLogs) console.log("SIMLI: Time between sends:", timeBetweenSends);
                }
            }
            this.lastSendTime = currentTime;
        } catch (error) {
            if (this.enableConsoleLogs) console.error("SIMLI: Failed to send audio data:", error);
            this.handleConnectionFailure("Failed to send audio data");
        }
    }

    close() {
        if (this.enableConsoleLogs) console.log("SIMLI: Closing SimliClient connection");
        this.emit("disconnected");

        try {
            this.cleanup();
        } catch (error) {
            if (this.enableConsoleLogs) console.error("SIMLI: Error during cleanup:", error);
        }
    }

    public ClearBuffer = () => {
        if (this.webSocket?.readyState === WebSocket.OPEN) {
            try {
                this.webSocket.send("SKIP");
            } catch (error) {
                if (this.enableConsoleLogs) console.error("SIMLI: Failed to clear buffer:", error);
            }
        } else {
            if (this.enableConsoleLogs) console.warn("SIMLI: Cannot clear buffer: WebSocket not open");
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

    private getWebSocketUrl(): [string, string] {
        let url = this.SimliURL;
        const parsedUrl = new URL(url);
        const baseUri = parsedUrl.host + parsedUrl.pathname;
        const protocol = url.startsWith('https') ? 'wss' : 'ws';
        return [protocol, baseUri];
    }
}

export {SimliClient, SimliClientConfig, SimliClientEvents};


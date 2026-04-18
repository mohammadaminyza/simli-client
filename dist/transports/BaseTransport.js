"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMessage = handleMessage;
exports.register_destination = register_destination;
function register_destination(logger, serialized_info) {
    const parsed = JSON.parse(serialized_info);
    logger.destination = parsed.destination;
    logger.session_id = parsed.session_id;
}
async function handleMessage(transport, message) {
    const firstToken = message.data.toUpperCase().split(" ")[0];
    switch (firstToken) {
        case "START": {
            // SOFT IGNORE
            break;
        }
        case "ACK": {
            transport.emit("ack");
            break;
        }
        case "STOP": {
            transport.disconnect();
            transport.emit("stop");
            break;
        }
        case "CLOSING":
        case "RATE":
        case "ERROR":
        case "ERROR:": {
            transport.disconnect();
            transport.emit("error", message.data);
        }
        case "SPEAK": {
            transport.emit("speaking");
            break;
        }
        case "SILENT": {
            transport.emit("silent");
            break;
        }
        default: {
            if (firstToken.includes("SDP") || firstToken.includes("LIVEKIT")) {
                transport.emit("connection_info", message.data);
            }
            else if (firstToken.includes("VIDEO_METADATA")) {
                transport.emit("video_info", message.data);
            }
            else if (firstToken.includes("ENDFRAME")) {
                transport.emit("stop");
                transport.disconnect();
            }
            else if (firstToken.includes("DESTINATION")) {
                transport.emit("destination", message.data);
            }
            else {
                transport.emit("unknown", message.data);
            }
        }
    }
}

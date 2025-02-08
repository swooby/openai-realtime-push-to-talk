import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";

export default function App() {
  const [showToolPanel, setShowToolPanel] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const peerConnection = useRef(null);
  const audioElement = useRef(null);
  const microphoneStream = useRef(null);

  async function startSession() {
    // Get an ephemeral key from the Fastify server
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.client_secret.value;

    // Create a peer connection
    const pc = new RTCPeerConnection();

    // Set up to play remote audio from the model
    audioElement.current = document.createElement("audio");
    audioElement.current.autoplay = true;
    pc.ontrack = (e) => (audioElement.current.srcObject = e.streams[0]);

    // Add local audio track for microphone input in the browser
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    microphoneStream.current = ms.getAudioTracks()[0];
    microphoneStream.current.enabled = false;
    pc.addTrack(microphoneStream.current);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }
    if (peerConnection.current) {
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  // Send a message to the model
  function sendClientEvent(message) {
    if (dataChannel) {
      message.event_id = message.event_id || crypto.randomUUID();
      const data = JSON.stringify(message);
      console.log(`sendClientEvent("${data}")`);
      dataChannel.send(data);
      setEvents((prev) => [message, ...prev]);
    } else {
      console.error(
        "Failed to send message - no data channel available",
        message,
      );
    }
  }

  function sendResponseCreate(responseConfig) {
    sendClientEvent({ 
      type: "response.create",
      response: responseConfig
    });
  }

  function sendSessionUpdate(sessionConfig) {
    const event = {
      type: "session.update",
      session: { 
        ...sessionConfig
      }
    };
    sendClientEvent(event);
  }

  // Send a text message to the model
  function sendTextMessage(message) {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendResponseCreate();
  }

  function handlePushToTalk(enable) {
    console.log(`handlePushToTalk(enable=${enable})`);
    if (enable) {
      // TODO: Mute audioElement.current...
      // TODO: Send interrupt... (requires tracking any incoming current response)
      sendClientEvent({type: 'input_audio_buffer.clear'});
      microphoneStream.current.enabled = true;
    } else {
      microphoneStream.current.enabled = false;
      sendClientEvent({type: 'input_audio_buffer.commit'});
      sendResponseCreate();
    }
  }

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", (e) => {
        setEvents((prev) => [JSON.parse(e.data), ...prev]);
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        setIsSessionActive(true);
        setEvents([]);
      });
    }
  }, [dataChannel]);

  useEffect(() => {
    if (isSessionActive) {
      console.log("Disabling turn detection");
      sendSessionUpdate({
        voice: "ash",
        turn_detection: null,
      });
    }
  }, [isSessionActive]);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <nav className="h-16 flex items-center border-b border-gray-200 px-4">
        <img src={logo} alt="Logo" style={{ width: "24px" }} />
        <h1 className="ml-4">realtime console</h1>
        {/* Toggle Tool Panel Chevron */}
        <button
          onClick={() => setShowToolPanel((prev) => !prev)}
          className="ml-auto p-2 border border-gray-300 rounded hover:bg-gray-100 focus:outline-none"
          aria-label={showToolPanel ? "Hide Tool Panel" : "Show Tool Panel"}
        >
          {showToolPanel ? (
            // When the panel is visible, show a chevron that points to the right.
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          ) : (
            // When the panel is hidden, show a chevron that points to the left.
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          )}
        </button>
      </nav>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left Section: Event Log and Session Controls */}
        <section className="flex flex-col flex-1">
          <div className="flex-1 overflow-y-auto px-4">
            <EventLog events={events} />
          </div>
          <div className="p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendClientEvent={sendClientEvent}
              sendTextMessage={sendTextMessage}
              handlePushToTalk={handlePushToTalk}
              events={events}
              isSessionActive={isSessionActive}
            />
          </div>
        </section>

        {/* Right Section: ToolPanel (conditionally rendered) */}
        {showToolPanel && (
          <section className="w-96 p-4 overflow-y-auto border-l border-gray-200">
            <ToolPanel
              sendClientEvent={sendClientEvent}
              sendResponseCreate={sendResponseCreate}
              events={events}
              isSessionActive={isSessionActive}
            />
          </section>
        )}
      </main>
    </div>
  );
}

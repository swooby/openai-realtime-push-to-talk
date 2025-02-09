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

  const currentAssistantConversationRef = useRef(null);

  async function startSession() {
    const model = "gpt-4o-mini-realtime-preview";
    const voice = "ash"; // alloy, ash, coral, echo, fable, onyx, nova, sage, or shimmer

    // Get an ephemeral key from the Fastify server
    const params = new URLSearchParams({ model, voice });
    const tokenResponse = await fetch(`/token?${params.toString()}`);
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
    updateCurrentAssistantConversation(null);
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

  function sendResponseCancel(responseId) {
    sendClientEvent({ 
      type: "response.cancel",
      response_id: responseId
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

  function pushToTalk(enable) {
    console.log(`pushToTalk(enable=${enable})`);
    if (enable) {
      muteSpeaker();
      interruptAssistant();
      sendClientEvent({type: 'input_audio_buffer.clear'});
      microphoneStream.current.enabled = true;
    } else {
      microphoneStream.current.enabled = false;
      sendClientEvent({type: 'input_audio_buffer.commit'});
      sendResponseCreate();
    }
  }

  function muteSpeaker() {
    console.log("TODO: Mute audioElement.current...");
    //...
  }

  function interruptAssistant() {
    sendResponseCancel();
    const currentAssistantConversation = currentAssistantConversationRef.current; 
    if (currentAssistantConversation) {
      const elapsedMillis = Date.now() - currentAssistantConversation.startTime;
      const item = currentAssistantConversation.item;
      const event = {
        type: "conversation.item.truncate",
        item_id: item.id,
        content_index: 0, // TODO: content.length,
        audio_end_ms: elapsedMillis,
      };
      sendClientEvent(event);
    }
  }

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", handleMessage);

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        console.info('Data channel opened');
        setIsSessionActive(true);
        setEvents([]);
      });

      dataChannel.addEventListener('close', () => {
        console.warn('Data channel closed');
        stopSession();
      });
    }
  }, [dataChannel]);

  function handleMessage(e) {
    const event = JSON.parse(e.data);
    switch (event.type) {
      case "error":
        console.error("error:", event);
        break;
      default:
        if (false) {
          console.log(`message:`, event);
        }
        break;
    }

    switch (event.type) {
      case "response.output_item.added": {
        const item = event.item;
        if (item.role === "assistant") {
          let currentAssistantConversation = currentAssistantConversationRef.current;
          if (item.id !== currentAssistantConversation?.item.id) {
            currentAssistantConversation = {
              item,
              startTime: new Date(),
            };
            currentAssistantConversationRef.current = currentAssistantConversation;
            console.log(`handleEvent: "response.output_item.added": Set currentAssistantConversation=${JSON.stringify(currentAssistantConversation)}`);
          }
        }
        break;
      }
      case "response.output_item.done": {
        const item = event.item;
        if (item.role === "assistant") {
          const currentAssistantConversation = currentAssistantConversationRef.current;
          if (item.id === currentAssistantConversation?.item.id) {
            currentAssistantConversationRef.current = null;
            console.log(`handleEvent: "response.output_item.done": Set currentAssistantConversation=null`);
          }
        }
      }
    }  
    
    setEvents((prev) => [event, ...prev]);
  }

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
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setEvents([])}
            disabled={events.length === 0}
            className={`p-2 border border-gray-300 rounded focus:outline-none ${
              events.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-100"
            }`}
          >
            Clear Events
          </button>
          <button
            onClick={() => setShowToolPanel((prev) => !prev)}
            className="flex items-center gap-2 flex-nowrap p-2 border border-gray-300 rounded hover:bg-gray-100 focus:outline-none"
            aria-label={showToolPanel ? "Hide Tool Panel" : "Show Tool Panel"}
          >
            <span>Tools/Functions</span>
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
        </div>
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
              pushToTalk={pushToTalk}
              interruptAssistant={interruptAssistant}
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

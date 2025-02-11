import { useEffect, useRef, useState } from "react";
import pkg from "../../package.json";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";

export default function App() {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [theme, setTheme] = useState(isDark ? "dark" : "light");

  const [showToolPanel, setShowToolPanel] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const peerConnection = useRef(null);
  const audioElement = useRef(null);
  const microphoneStream = useRef(null);

  const currentAssistantConversationRef = useRef(null);

  useEffect(() => {
    if (theme === "dark") {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }

  async function requestEphermalKey({dangerousApiKey, model, voice}) {
    model = model || "gpt-4o-mini-realtime-preview";
    voice = voice || "ash"; // alloy, ash, coral, echo, fable, onyx, nova, sage, or shimmer
  
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dangerousApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
      }),
    });
  
    return new Response(r.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });  
  }

  async function startSession(dangerousApiKey) {
    const model = "gpt-4o-mini-realtime-preview";
    const voice = "ash"; // alloy, ash, coral, echo, fable, onyx, nova, sage, or shimmer

    // Get an ephemeral key directly from the OpenAI server
    const tokenResponse = await requestEphermalKey({dangerousApiKey, model, voice});
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

    peerConnection.current.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });
    
    if (peerConnection.current) {
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    currentAssistantConversationRef.current = null;
    peerConnection.current = null;
  }

  // Send a message to the model
  function sendClientEvent(message) {
    if (dataChannel) {
      message.event_id = message.event_id || crypto.randomUUID();
      const data = JSON.stringify(message);
      console.log(`sendClientEvent("${data}")`);
      dataChannel.send(data);
      addMessage(message);
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
    interruptAssistant();
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
    const currentAssistantConversation = currentAssistantConversationRef.current; 
    if (currentAssistantConversation) {
      sendResponseCancel(currentAssistantConversation.responseId);
      const elapsedMillis = Date.now() - currentAssistantConversation.startTime;
      const item = currentAssistantConversation.item;
      const event = {
        type: "conversation.item.truncate",
        item_id: item.id,
        content_index: 0, // TODO: calculate content.length from list of delta items
        audio_end_ms: elapsedMillis,
      };
      sendClientEvent(event);
    }
  }

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", handleServerMessage);

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

  function addMessage(message) {
    message.timestamp = new Date();
    // This is simple and "works", but this is not very efficient for large collections.
    // This "insert at head" involves copying the entire array each time.
    // One option is to insert at the end (which requires no array copy),
    // and then have EventLog reverse the order of the events when rendering.
    // Another option is to use a virtualized list library like react-window or react-virtualized.
    setEvents((prev) => [message, ...prev]);
  }

  function handleServerMessage(message) {
    message = JSON.parse(message.data);
    switch (message.type) {
      case "error":
        console.error("error:", message);
        break;
      default:
        if (false) {
          console.log(`message:`, message);
        }
        break;
    }

    switch (message.type) {
      case "response.output_item.added": {
        const item = message.item;
        if (item.role === "assistant") {
          let currentAssistantConversation = currentAssistantConversationRef.current;
          if (item.id !== currentAssistantConversation?.item.id) {
            currentAssistantConversation = {
              responseId: message.response_id,
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
        const item = message.item;
        if (item.role === "assistant") {
          const currentAssistantConversation = currentAssistantConversationRef.current;
          if (item.id === currentAssistantConversation?.item.id) {
            currentAssistantConversationRef.current = null;
            console.log(`handleEvent: "response.output_item.done": Set currentAssistantConversation=null`);
          }
        }
      }
    }

    addMessage(message);
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
        <svg xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 320 320"
          width="24" height="24"
          fill={ theme === "light" ? "#000000" : "#ffffff" }
        >
          <path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"/>
        </svg>
        <h1 className="ml-4">realtime console ({pkg.version})</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setEvents([])}
            disabled={events.length === 0}
            className={`h-11 p-2 border border-gray-300 rounded focus:outline-hidden ${
              events.length === 0 ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            Clear Events
          </button>
          <button
            onClick={() => setShowToolPanel((prev) => !prev)}
            className="h-11 flex items-center gap-2 flex-nowrap p-2 border border-gray-300 rounded-sm focus:outline-hidden"
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
          <button
            onClick={toggleTheme}
            className="h-11 p-2 border border-gray-300 rounded"
          >
            {theme === "light" ? (
              <svg xmlns="http://www.w3.org/2000/svg"
                className="lucide lucide-moon"
                width="24" height="24" viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg"
                className="lucide lucide-sun"
                width="24" height="24" viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"></circle>
                <path d="M12 2v2"></path>
                <path d="M12 20v2"></path>
                <path d="m4.93 4.93 1.41 1.41"></path>
                <path d="m17.66 17.66 1.41 1.41"></path>
                <path d="M2 12h2"></path>
                <path d="M20 12h2"></path>
                <path d="m6.34 17.66-1.41 1.41"></path>
                <path d="m19.07 4.93-1.41 1.41"></path>
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
          <div className="px-4">
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

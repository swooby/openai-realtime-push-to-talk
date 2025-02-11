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

  /**
   * Only ever called by startSession(dangerousApiKey) to directly request a one-minute ephemeral key from api.openai.com.
   * This method, and in fact this entire app, only ever sends the dangerousApiKey directly to api.openai.com.
   * The dangerousApiKey is otherwise never logged, stored, or sent anywhere else.
   * @param {object} options { dangerousApiKey, model, voice }
   * @param {string} options.dangerousApiKey OpenAI API Key; only ever sent directly to api.openai.com to request a one-minute ephemeral key
   * @param {string} options.model OpenAI model name; https://platform.openai.com/docs/models#gpt-4o-realtime
   * @param {string} options.voice OpenAI voice name; https://platform.openai.com/docs/api-reference/realtime-sessions/create#realtime-sessions-create-voice
   * @returns 
   */
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

  /**
   * Only ever called by SessionControls.SessionStopped.handleStartSession().
   * This method, and in fact this entire app, only ever sends the dangerousApiKey directly to api.openai.com.
   * The dangerousApiKey is otherwise never logged, stored, or sent anywhere else.
   * @param {string} dangerousApiKey OpenAI API Key; only ever sent directly to api.openai.com to request a one-minute ephemeral key
   */
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
        <a href={pkg.homepage} target="_blank" rel="noopener noreferrer">
          <svg
            viewBox="0 0 24 24"
            width="32" height="32"
            aria-hidden="true"  version="1.1"
            data-view-component="true"
            class="octicon octicon-mark-github v-align-middle"
            fill={ theme === "light" ? "#000000" : "#ffffff" }
          >
            <path d="M12.5.75C6.146.75 1 5.896 1 12.25c0 5.089 3.292 9.387 7.863 10.91.575.101.79-.244.79-.546 0-.273-.014-1.178-.014-2.142-2.889.532-3.636-.704-3.866-1.35-.13-.331-.69-1.352-1.18-1.625-.402-.216-.977-.748-.014-.762.906-.014 1.553.834 1.769 1.179 1.035 1.74 2.688 1.25 3.349.948.1-.747.402-1.25.733-1.538-2.559-.287-5.232-1.279-5.232-5.678 0-1.25.445-2.285 1.178-3.09-.115-.288-.517-1.467.115-3.048 0 0 .963-.302 3.163 1.179.92-.259 1.897-.388 2.875-.388.977 0 1.955.13 2.875.388 2.2-1.495 3.162-1.179 3.162-1.179.633 1.581.23 2.76.115 3.048.733.805 1.179 1.825 1.179 3.09 0 4.413-2.688 5.39-5.247 5.678.417.36.776 1.05.776 2.128 0 1.538-.014 2.774-.014 3.162 0 .302.216.662.79.547C20.709 21.637 24 17.324 24 12.25 24 5.896 18.854.75 12.5.75Z"></path>
          </svg>
        </a>
        <h1 className="ml-4">{pkg.title} ({pkg.version} {pkg.timestamp})</h1>
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

import { useEffect, useRef, useState } from "react";
import { CloudLightning, CloudOff, MessageSquare } from "react-feather";
import Button from "./Button";

function SessionStopped({ startSession }) {
  const [isActivating, setIsActivating] = useState(false);
  const [dangerousApiKey, setDangerousApiKey] = useState("");
  const [showMore, setShowMore] = useState(false);

  function handleStartSession() {
    if (isActivating) return;
    if (!dangerousApiKey) {
      alert("Please enter your OpenAI API Key.");
      return;
    }
    setIsActivating(true);
    startSession(dangerousApiKey);
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full p-4">
      <div className="flex items-center w-full space-x-4">
        <label htmlFor="openai-api-key" className="whitespace-nowrap">
          <a href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowMore(!showMore);
            }}
            className="underline"
          >
            OpenAI API Key:
          </a>
        </label>
        <input
          id="openai-api-key"
          type="password"
          placeholder="!!KEEP YOUR OPEN AI API KEY SECRET!!"
          value={dangerousApiKey}
          onChange={(e) => setDangerousApiKey(e.target.value)}
          className="w-full border border-gray-300 rounded-sm p-3"
        />
        <Button
          onClick={handleStartSession}
          className={`px-8 whitespace-nowrap ${isActivating ? "bg-gray-600" : "bg-red-600"}`}
          icon={<CloudLightning height={16} />}
        >
          {isActivating ? "Starting session..." : "Start session"}
        </Button>
      </div>
      {showMore && (
        <div className="">
          <b>You must provide <i>your own</i> OpenAI API Key to connect to OpenAI's Realtime API with.</b><br/>
          This <a href="https://github.com/swooby/openai-realtime-push-to-talk/blob/main/client/components/App.jsx#L18-L40" target="_blank" rel="noopener noreferrer" className="underline">[open source]</a> app <b>only ever sends this value directly to https://api.openai.com</b>.<br/>
          If you don't already have an OpenAI API key:
          <ol className="list-decimal list-inside ml-4">
            <li>
              Create one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline">https://platform.openai.com/api-keys</a> with permissions:
              <ul className="list-disc list-inside ml-4">
                <li><pre style={{ display:'inline', margin:0, padding:0 }}>Models</pre> = <pre style={{ display:'inline', margin:0, padding:0 }}>Read</pre></li>
                <li><pre style={{ display:'inline', margin:0, padding:0 }}>Model capabilities</pre> = <pre style={{ display:'inline', margin:0, padding:0 }}>Write</pre></li>
              </ul>
            </li>
            <li>
              Copy your OpenAI API key and then paste it into the <b><pre style={{ display:'inline', margin:0, padding:0 }}>OpenAI API Key</pre></b> field above.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}

function SessionActive({ stopSession, sendTextMessage, pushToTalk, interruptAssistant }) {
  const [message, setMessage] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  function handleSendClientEvent() {
    sendTextMessage(message);
    setMessage("");
  }

  return (
    <div className="flex gap-4 w-full py-4">
      {/* Left Column: Input Controls – takes up all available space */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Row 1: Text Input */}
        <input
          ref={inputRef}
          type="text"
          placeholder="Send a text message..."
          className="w-full border border-gray-200 rounded-full p-4"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && message.trim()) {
              handleSendClientEvent();
            }
          }}
        />
        {/* Row 2: Push To Talk Button */}
        <Button
          onMouseDown={() => pushToTalk(true)}
          onMouseUp={() => pushToTalk(false)}
          className="w-full bg-green-500 flex items-center justify-center px-8 whitespace-nowrap"
        >
          Push To Talk
        </Button>
      </div>

      {/* Right Column: Action Buttons – sized by content */}
      <div className="flex flex-col gap-4">
        {/* Row 1: Send Text and Disconnect Buttons side by side */}
        <div className="flex gap-4">
          <Button
            onClick={() => {
              if (message.trim()) {
                handleSendClientEvent();
              }
            }}
            icon={<MessageSquare height={16} />}
            className="flex-1 bg-blue-400 px-8 whitespace-nowrap"
          >
            Send Text
          </Button>
          <Button
            onClick={stopSession}
            icon={<CloudOff height={16} />}
            className="flex-1 px-8 whitespace-nowrap"
          >
            Disconnect
          </Button>
        </div>
        {/* Row 2: Stop/Interrupt/Truncate Button */}
        <Button
          onClick={interruptAssistant}
          className="w-full bg-red-500 flex items-center justify-center px-8 whitespace-nowrap"
        >
          Stop/Interrupt/Truncate Assistant
        </Button>
      </div>
    </div>
  );
}

export default function SessionControls({
  startSession,
  stopSession,
  sendClientEvent,
  sendTextMessage,
  pushToTalk,
  interruptAssistant,
  serverEvents,
  isSessionActive,
}) {
  return (
    <div className="flex gap-4 border-t-2 border-gray-200 h-full rounded-md">
      {isSessionActive ? (
        <SessionActive
          stopSession={stopSession}
          sendClientEvent={sendClientEvent}
          sendTextMessage={sendTextMessage}
          pushToTalk={pushToTalk}
          interruptAssistant={interruptAssistant}
          serverEvents={serverEvents}
        />
      ) : (
        <SessionStopped startSession={startSession} />
      )}
    </div>
  );
}

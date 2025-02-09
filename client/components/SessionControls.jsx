import { useEffect, useRef, useState } from "react";
import { CloudLightning, CloudOff, MessageSquare } from "react-feather";
import Button from "./Button";

function SessionStopped({ startSession }) {
  const [isActivating, setIsActivating] = useState(false);

  function handleStartSession() {
    if (isActivating) return;

    setIsActivating(true);
    startSession();
  }

  return (
    <div className="flex items-center justify-center w-full h-full mt-4">
      <Button
        onClick={handleStartSession}
        className={isActivating ? "bg-gray-600" : "bg-red-600"}
        icon={<CloudLightning height={16} />}
      >
        {isActivating ? "starting session..." : "start session"}
      </Button>
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
    <div className="flex flex-col items-center justify-center w-full h-full mt-4">
      <div className="flex items-center justify-center w-full gap-4">
        <input
          ref={inputRef}
          onKeyDown={(e) => {
            if (e.key === "Enter" && message.trim()) {
              handleSendClientEvent();
            }
          }}
          type="text"
          placeholder="send a text message..."
          className="border border-gray-200 rounded-full p-4 flex-1"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button
          onClick={() => {
            if (message.trim()) {
              handleSendClientEvent();
            }
          }}
          icon={<MessageSquare height={16} />}
          className="bg-blue-400"
        >
          send text
        </Button>
        <Button onClick={stopSession} icon={<CloudOff height={16} />}>
          disconnect
        </Button>
      </div>
      <div className="mt-4 w-full flex gap-4">
        <Button
          onMouseDown={() => pushToTalk(true)}
          onMouseUp={() => pushToTalk(false)}
          className="bg-green-500 w-full flex items-center justify-center"
        >
          Push To Talk
        </Button>
        <Button
          onClick={interruptAssistant}
          className="bg-red-500 flex items-center justify-center px-8 whitespace-nowrap"
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

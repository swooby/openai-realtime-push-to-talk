import { ArrowUp, ArrowDown } from "react-feather";
import { useState } from "react";

function Event({ event, timestamp }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isClient = event.event_id && !event.event_id.startsWith("event_");

  const isError = event.error || event.error_message;

  return (
    <div className={`flex flex-col gap-2 p-2 rounded-md border border-gray-300 ${isError ? "bg-yellow-100" : ""}`}>
      <div
        className="flex items-center gap-2 cursor-pointer text-sm"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div>
          {timestamp}&nbsp;|&nbsp;
          {isClient ? (
            <span className="text-green-400">⇧</span>
          ) : (
            <span className="text-blue-400">⇩</span>
          )}&nbsp;
          {isClient ? "client:" : "server:"}
          &nbsp;{event.type}
        </div>
      </div>
      <div
        className={`p-2 rounded-md overflow-x-auto ${
          isExpanded ? "block" : "hidden"
        }`}
      >
        <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(event, null, 2)}</pre>
      </div>
    </div>
  );
}

export default function EventLog({ events }) {
  const eventsToDisplay = [];
  let deltaEvents = {};

  events.forEach((event) => {
    if (event.type.endsWith("delta")) {
      if (deltaEvents[event.type]) {
        // for now just log a single event per render pass
        return;
      } else {
        deltaEvents[event.type] = event;
      }
    }

    eventsToDisplay.push(
      <Event
        key={event.event_id}
        event={event}
        timestamp={event.timestamp.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3,
          hour12: false,
        })}
      />,
    );
  });

  return (
    <div className="flex flex-col gap-2 overflow-x-auto py-4">
      {events.length === 0 ? (
        <div className="">Awaiting events...</div>
      ) : (
        eventsToDisplay
      )}
    </div>
  );
}

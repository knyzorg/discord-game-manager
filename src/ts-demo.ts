declare type Channel = "general" | "lobby" | "watercooler";
declare type LeaveReason = "timeout" | "ban" | "disconnect";

interface ChatEvents {
  message: {
    user: string;
    message: string;
  };
  join: {
    user: string;
    channel: Channel;
  };
  leave: {
    user: string;
    reason: LeaveReason;
  };
}

declare type ChatEvent = keyof ChatEvents;

interface SubEvents extends Record<ChatEvent, string> {
  message: Channel;
  leave: LeaveReason;
}

declare type EventWithSubEvent<T extends ChatEvent> = `${T}${
  | ""
  | `:${SubEvents[T]}`}`;

class Chatbot {
  subscribers: Map<string, Set<(payload: any) => void>> = new Map();
  on<K extends ChatEvent>(
    event: EventWithSubEvent<K>,
    callback: (payload: ChatEvents[K]) => void
  ) {
    if (!this.subscribers.has(event)) this.subscribers.set(event, new Set());
    this.subscribers.get(event).add(callback);
  }
  dispatch<K extends ChatEvent>(
    event: EventWithSubEvent<K>,
    payload: ChatEvents[K]
  ) {
    for (let cb of this.subscribers.get(event)) cb(payload);
  }
}

const bot = new Chatbot();
bot.on("message:general", (payload) => {
  console.log(payload.user, "sent", payload.message);
});

bot.on("message:general", (payload) => console.log(payload));

import Discord from "discord.js";

declare type ChatEvents = {
  message: {
    content: string;
    authorId: string;
    messageId: string;
  };
  connect: {
    channel: Channel;
  };
  disconnect: void;
};

declare type ChatEvent = keyof ChatEvents;

interface SubEvents extends Record<ChatEvent, string> {
  message: Channel;
  connect: Channel;
}

declare type EventWithSubEvent<T extends ChatEvent> = T extends any
  ? `${T}:${SubEvents[T] | "*"}`
  : never;

declare type Channel = "village" | "mafia" | "admin";

export default class GameServer {
  guild: Discord.Guild;
  bot: Discord.Client<boolean>;
  callbacks: Map<string, Set<(callback: ChatEvents[ChatEvent]) => void>> =
    new Map();
  prefix = "mafia-";
  voiceChannels: Record<Channel, Discord.VoiceChannel> = {
    mafia: null,
    village: null,
    admin: null,
  };
  textChannels: Record<Channel, Discord.TextChannel> = {
    mafia: null,
    village: null,
    admin: null,
  };
  players: Set<Discord.GuildMember> = new Set();
  villagers: Set<Discord.GuildMember> = new Set();
  mafia: Set<Discord.GuildMember> = new Set();
  beds: Map<Discord.GuildMember, Discord.VoiceChannel> = new Map();

  constructor(bot: Discord.Client<boolean>, guild: Discord.Guild) {
    this.guild = guild;
    this.bot = bot;

    this.prepareGame();
  }

  async join(player: Discord.GuildMember) {
    if (!this.players.has(player)) {
      console.log(player.displayName, "has joined the game!");
      this.players.add(player);
    }
  }
  async leave(player: Discord.GuildMember) {
    if (this.players.has(player)) {
      console.log(player.displayName, "has left the game!");
      this.players.delete(player);
    }
  }

  async createChannels() {
    console.log("Creating channels...");
    // Cleanup old channels
    const deleting = this.guild.channels.cache
      .filter((c) => c.name.startsWith(this.prefix))
      .map(async (c) => await c.delete("Cleaning up"));

    // Wait to finish deleting
    await Promise.all(deleting);

    // Create new voice channels
    for (let channelName of Object.keys(this.voiceChannels)) {
      const channel = await this.guild.channels.create(
        `${this.prefix}${channelName}`,
        {
          type: "GUILD_VOICE",
        }
      );

      this.voiceChannels[channelName as Channel] = channel;
      console.log("Created voice channel", channel.name);
    }
    // Create new text channels
    for (let channelName of Object.keys(this.textChannels)) {
      const channel = await this.guild.channels.create(
        `${this.prefix}${channelName}`,
        {
          type: "GUILD_TEXT",
        }
      );

      this.textChannels[channelName as Channel] = channel;
      console.log("Created text channel", channel.name);
    }
  }
  async messageHandler(message: Discord.Message) {
    // ignore messages not from current guild
    if (message.guild != this.guild) return;

    console.log("Message received", message.content);
    const payload = {
      authorId: message.author.username,
      content: message.content,
      messageId: message.id,
    };
    this.dispatch("message:*", payload);
    for (let [name, channel] of Object.entries(this.textChannels)) {
      if (message.channel.id == channel.id) {
        console.log("Dispatching to", name);
        this.dispatch(`message:${name as Channel}`, payload);
      }
    }
  }

  async setupSleepHandler() {
    this.on("message:admin", (message) => {
      if (message.content == "sleep") this.sleep();
    });
  }
  async setupWakeHandler() {
    this.on("message:admin", (message) => {
      if (message.content == "wake") this.wake();
    });
  }

  async handleVoiceStateUpdateHandler(
    oldState: Discord.VoiceState,
    newState: Discord.VoiceState
  ) {
    if (
      Object.values(this.voiceChannels).includes(
        newState.channel as Discord.VoiceChannel
      )
    )
      await this.join(newState.member);
    else if (
      Object.values(this.voiceChannels).includes(
        oldState.channel as Discord.VoiceChannel
      ) &&
      !newState.channel.name.startsWith(this.prefix)
    )
      await this.leave(oldState.member);
  }

  async prepareGame() {
    await this.createChannels();
    this.bot.on("message", (message) => this.messageHandler(message));
    this.bot.on("voiceStateUpdate", (a, b) =>
      this.handleVoiceStateUpdateHandler(a, b)
    );
    this.setupSleepHandler();
    this.setupWakeHandler();
  }

  async getBed(user: Discord.GuildMember) {
    if (!this.beds.has(user)) {
      const channel = await this.guild.channels.create(
        `${this.prefix}${user.displayName}-bed`,
        {
          type: "GUILD_VOICE",
        }
      );
      this.beds.set(user, channel);

      channel.permissionOverwrites.create(this.guild.roles.everyone, {
        VIEW_CHANNEL: false,
      });
    }

    return this.beds.get(user);
  }

  async sleep() {
    console.log("Sleeping, moving all to bed");
    for (let player of this.players)
      await player.voice.setChannel(await this.getBed(player));
  }

  async wake() {
    console.log("Waking up, moving all to village");
    for (let player of this.players)
      await player.voice.setChannel(this.voiceChannels.village);
  }

  /**
   * Subscibe to events
   * @param event Event to listen to
   * @param callback Callback to receive payload when event fires
   * @returns Callback function to remove listener
   */
  on<K extends ChatEvent>(
    event: EventWithSubEvent<K>,
    callback: (payload: ChatEvents[K]) => void
  ) {
    if (!this.callbacks.has(event)) this.callbacks.set(event, new Set());
    this.callbacks.get(event).add(callback);
    return () => this.callbacks.get(event).delete(callback);
  }
  /**
   * Dispatch a payload for an event. For internal use.
   * @param event Event to dispatch
   * @param payload Event payload to dispatch
   */
  dispatch<K extends ChatEvent>(
    event: EventWithSubEvent<K> | K,
    payload: ChatEvents[K]
  ) {
    for (let cb of this.callbacks.get(event) ?? []) cb(payload);
  }
}

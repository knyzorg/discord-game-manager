import Discord, { TextChannel } from "discord.js";

type ChatEvents = {
  message: {
    user: Discord.GuildMember;
    message: Discord.Message;
  };
  connect: {
    user: Discord.GuildMember;
    channel: Discord.VoiceChannel;
  };
  disconnect: {
    user: Discord.GuildMember;
    channel: Discord.VoiceChannel;
  };
};

type ChatEvent = keyof ChatEvents;
type EventWithChannel<T extends ChatEvent> = T | `${T}:${string}`;

export default class GameServer {
  guild: Discord.Guild;
  bot: Discord.Client<boolean>;
  callbacks: Map<string, Set<(callback: ChatEvents[ChatEvent]) => void>>;
  prefix = "mafia-";

  channels: Map<string, Discord.Channel>;
  voiceChannels: Map<string, Discord.VoiceChannel>;
  textChannels: Map<string, Discord.TextChannel>;

  constructor(bot: Discord.Client<boolean>, guild: Discord.Guild) {
    this.guild = guild;
    this.bot = bot;

    this.prepareGame();
  }

  async cleanup() {
    this.bot.removeAllListeners();

    console.log("Creating channels...");
    // Cleanup old channels
    const deleting = this.guild.channels.cache
      .filter((c) => c.name.startsWith(this.prefix))
      .map(async (c) => await c.delete("Cleaning up"));

    // Wait to finish deleting
    await Promise.all(deleting);
  }

  isGameChannel(channel: Discord.Channel) {
    return [...this.channels.values()].includes(channel);
  }

  async removeChannel(channel: string | Discord.Channel) {
    if (typeof channel == "string") await this.channels.get(channel).delete();
    else channel.delete();
  }

  async messageHandler(message: Discord.Message) {
    const { channel, guild, member, content } = message;
    // ignore messages not from current guild or game channels
    if (
      guild != this.guild ||
      !this.isGameChannel(channel as Discord.TextChannel)
    )
      return;

    console.log("Message received", content);
    const payload = {
      user: member,
      message: message,
    };
    this.dispatch<"message">("message", payload);

    for (let [channelName, channel] of this.textChannels) {
      if (channel == (channel as Discord.TextChannel)) {
        console.log("Dispatching to", channelName);
        this.dispatch(`message:${channelName}`, payload);
      }
    }
  }

  async handleVoiceStateUpdateHandler(
    oldState: Discord.VoiceState,
    newState: Discord.VoiceState
  ) {
    if (
      !this.isGameChannel(oldState.channel) &&
      this.isGameChannel(newState.channel)
    ) {
      this.dispatch<"connect">("connect", {
        channel: newState.member.voice.channel as Discord.VoiceChannel,
        user: newState.member,
      });
    }

    if (
      this.isGameChannel(oldState.channel) &&
      !this.isGameChannel(newState.channel)
    ) {
      this.dispatch<"disconnect">("disconnect", {
        channel: oldState.member.voice.channel as Discord.VoiceChannel,
        user: oldState.member,
      });
    }
  }

  async prepareGame() {
    await this.cleanup();
    this.bot.on("message", (...args) => this.messageHandler(...args));
    this.bot.on("voiceStateUpdate", (...args) =>
      this.handleVoiceStateUpdateHandler(...args)
    );

    this.callbacks = new Map();
    this.channels = new Map();
    this.voiceChannels = new Map();
    this.textChannels = new Map();
  }

  async createPublicChannel<T extends "GUILD_VOICE" | "GUILD_TEXT">(
    name: string,
    type: T
  ): Promise<
    T extends "GUILD_VOICE" ? Discord.VoiceChannel : Discord.TextChannel
  > {
    if (this.channels.has(name)) throw Error("Channel already exists");

    const channel = (await this.guild.channels.create(`${this.prefix}${name}`, {
      type,
    })) as T extends "GUILD_VOICE" ? Discord.VoiceChannel : Discord.TextChannel;

    this.channels.set(name, channel);
    switch (type) {
      case "GUILD_TEXT":
        this.textChannels.set(name, channel as Discord.TextChannel);
        break;
      case "GUILD_VOICE":
        this.voiceChannels.set(name, channel as Discord.VoiceChannel);
        break;
    }
    return channel;
  }

  async createSecretChannel<T extends "GUILD_VOICE" | "GUILD_TEXT">(
    name: string,
    type: T
  ) {
    const channel = await this.createPublicChannel(name, type);
    await channel.permissionOverwrites.create(this.guild.roles.everyone, {
      VIEW_CHANNEL: false,
    });
    return channel;
  }

  async moveUserToChannel(
    user: Discord.GuildMember,
    channel: Discord.VoiceChannel
  ) {
    if (!user.voice.channel) await user.voice.setChannel(channel);
  }

  /**
   * Subscibe to events
   * @param event Event to listen to
   * @param callback Callback to receive payload when event fires
   * @returns Callback function to remove listener
   */
  on<K extends ChatEvent>(
    event: EventWithChannel<K>,
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
    event: EventWithChannel<K>,
    payload: ChatEvents[K]
  ) {
    console.log("Dispatching event", event, "with", payload);
    for (let cb of this.callbacks.get(event) ?? []) cb(payload);
  }
}

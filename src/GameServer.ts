import Discord, {
  InternalDiscordGatewayAdapterCreator,
  TextChannel,
  VoiceChannel,
} from "discord.js";
import { v4 as uuidv4 } from "uuid";

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

type AsyncToken<T> = {
  promise: Promise<T>;
  reject: () => void;
  resolve: (value: T) => void;
};

export type Prompt<T> = {
  getReply: () => Promise<T | null>;
  cancel: (withValue?: T) => void;
  delete: () => Promise<void>;
};
export default class GameServer {
  guild: Discord.Guild;
  bot: Discord.Client<boolean>;
  callbacks: Map<string, Set<(callback: ChatEvents[ChatEvent]) => void>>;
  prefix: string;

  channels: Map<string, Discord.VoiceChannel | Discord.TextChannel>;
  voiceChannels: Map<string, Discord.VoiceChannel>;
  textChannels: Map<string, Discord.TextChannel>;

  constructor(
    bot: Discord.Client<boolean>,
    guild: Discord.Guild,
    prefix = "game-"
  ) {
    this.guild = guild;
    this.bot = bot;
    this.prefix = prefix;
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

  isGameChannel(channel: Discord.VoiceChannel | Discord.TextChannel) {
    return [...this.channels.values()].includes(channel);
  }

  getChannelUsers(channel: Discord.VoiceChannel | string) {
    return this.voiceChannels
      .get(this.getChannelName(channel))
      .members.map((m) => m);
  }

  getChannelName(channel: Discord.VoiceChannel | Discord.TextChannel | string) {
    if (channel == null) return null;
    if (typeof channel == "string")
      if (this.channels.has(channel)) return channel;
      else throw new Error(`Channel ${channel} not part of game`);

    for (let channelPair of this.channels) {
      if (channelPair[1] == channel) return channelPair[0];
    }
    throw new Error("Channel not part of game");
  }
  async removeChannel(
    channel: string | Discord.TextChannel | Discord.VoiceChannel
  ) {
    let channelName = this.getChannelName(channel);
    await this.channels.get(channelName).delete();
    this.channels.delete(channelName);
    this.voiceChannels.delete(channelName);
    this.textChannels.delete(channelName);
  }

  async messageHandler(message: Discord.Message) {
    const { channel, guild, member, content } = message;
    // ignore messages not from current guild or game channels
    if (
      guild != this.guild ||
      !this.isGameChannel(channel as Discord.TextChannel)
    )
      return;

    if (member.id == this.bot.user.id) return;
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
    // Detect full connect/disconnects
    if (
      !this.isGameChannel(oldState.channel as Discord.VoiceChannel) &&
      this.isGameChannel(newState.channel as Discord.VoiceChannel)
    ) {
      this.dispatch<"connect">("connect", {
        channel: newState.channel as Discord.VoiceChannel,
        user: newState.member,
      });
    }

    if (
      this.isGameChannel(oldState.channel as Discord.VoiceChannel) &&
      !this.isGameChannel(newState.channel as Discord.VoiceChannel)
    ) {
      this.dispatch<"disconnect">("disconnect", {
        channel: oldState.channel as Discord.VoiceChannel,
        user: oldState.member,
      });
    }

    const oldChannelName = this.getChannelName(
      oldState.channel as VoiceChannel
    );
    const newChannelName = this.getChannelName(
      newState.channel as VoiceChannel
    );
    if (oldChannelName)
      this.dispatch<"disconnect">(`disconnect:${oldChannelName}`, {
        channel: oldState.channel as Discord.VoiceChannel,
        user: oldState.member,
      });
    if (newChannelName)
      this.dispatch<"connect">(`connect:${newChannelName}`, {
        channel: newState.channel as Discord.VoiceChannel,
        user: newState.member,
      });
  }

  async init() {
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

  async setChannelAccess(
    user: Discord.GuildMember,
    channelName: string,
    allow: boolean
  ) {
    const channel = this.channels.get(channelName);
    if (!channel) throw new Error("Channel does not exist");
    await channel.permissionOverwrites.create(user, {
      VIEW_CHANNEL: allow,
    });
  }

  async setChannelLock(channelName: string, lock: boolean) {
    const channel = this.channels.get(channelName);
    if (!channel) throw new Error("Channel does not exist");
    await channel.permissionOverwrites.create(this.guild.roles.everyone, {
      SEND_MESSAGES: !lock,
    });
  }

  async moveToChannel(
    user: Discord.GuildMember,
    channel: string | Discord.VoiceChannel
  ) {
    const channelName = this.getChannelName(channel);
    if (!user.voice.channel) throw new Error("User is not in channel");
    if (!this.isGameChannel(user.voice.channel as Discord.VoiceChannel))
      throw new Error("User is not in game channel");

    await user.voice.setChannel(this.voiceChannels.get(channelName));
  }

  async sendMessage(channel: string | Discord.TextChannel, message: string) {
    return await this.textChannels
      .get(this.getChannelName(channel))
      .send(message);
  }

  async prompt<T extends string>(
    channel: string | Discord.TextChannel,
    query: string,
    options: T[]
  ): Promise<Prompt<T>> {
    const fullfillmentToken = createAsyncToken<T | null>();

    const optionById = new Map<string, T>();
    const idByOption = new Map<T, string>();
    for (let option of options) {
      const responseId = `query-${uuidv4()}`;
      optionById.set(responseId, option);
      idByOption.set(option, responseId);
    }

    const message = await this.textChannels
      .get(this.getChannelName(channel))
      .send({
        content: query,
        components: [
          new Discord.MessageActionRow({
            components: options.map(
              (option) =>
                new Discord.MessageButton({
                  customId: idByOption.get(option),
                  label: option,
                  style: "PRIMARY",
                })
            ),
          }),
        ],
      });

    const handlers: ((interaction: Discord.Interaction) => void)[] = [];
    const waitForReponse = (customId: string) =>
      new Promise<void>((resolve) => {
        const option = optionById.get(customId);
        const interactionHandler = (interaction: Discord.Interaction) => {
          if (!interaction.isButton()) return;
          if (interaction.customId == customId) {
            console.log("Pressed button", option);

            interaction.deferUpdate();

            // Response arrived! Resolving.
            fullfillmentToken.resolve(option);
          }
        };
        this.bot.on("interactionCreate", interactionHandler);
        handlers.push(interactionHandler);

        // If fullfillment token comes back before a reply, another option was selected.
        fullfillmentToken.promise.then((option) => {
          resolve();
          message.edit({
            content: `${message.content}\n*${option ?? "No reply"}*`,
            components: [],
          });
        });
      });

    for (let [customId] of optionById) {
      waitForReponse(customId);
    }

    fullfillmentToken.promise.then(() => {
      for (let handler of handlers) this.bot.off("interactionCreate", handler);
    });

    return {
      getReply: () => fullfillmentToken.promise,
      cancel: (withValue) => fullfillmentToken.resolve(withValue ?? null),
      delete: async () => {
        fullfillmentToken.resolve(null);
        await message.delete();
      },
    };
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
    console.log("Dispatching event", event);
    for (let cb of this.callbacks.get(event) ?? []) cb(payload);
  }
}

export function createAsyncToken<T = void>(): AsyncToken<T> {
  let reject: () => void;
  let resolve: (value: T) => void;
  let promise = new Promise<T>((res, rej) => {
    [reject, resolve] = [rej, res];
  });

  return {
    promise,
    reject,
    resolve,
  };
}

import Discord, { VoiceChannel } from "discord.js";
import GameServer, { Prompt } from "./GameServer";
import { wait } from "./util/Timer";

type Role =
  | "President"
  | "Bomber"
  | "Sniper"
  | "Target"
  | "Decoy"
  | "Hot Potato";

type Phase =
  | "Starting"
  | "Nominating"
  | "Sharing"
  | "Switching"
  | "Ending"
  | "Aborting";

export default class TwoRoomsOneBoomController {
  server: GameServer;
  players: Set<Discord.GuildMember>;
  roles: Map<Discord.GuildMember, Role>;
  privateChannels: Map<Discord.GuildMember, string>;
  phase: Phase;
  presidents: {
    "room-one": Discord.GuildMember;
    "room-two": Discord.GuildMember;
  };
  constructor(server: GameServer) {
    this.server = server;
    this.startPhase();
  }

  async abort(reason?: string) {
    await this.server.sendMessage(
      "admin",
      `**Game Aborted**. Reason: ${reason ?? "Unknown"}`
    );
  }
  async startPhase() {
    this.players = new Set();
    this.roles = new Map();
    this.privateChannels = new Map();
    this.phase = "Starting";
    await this.server.init();
    const server = this.server;
    await server.createPublicChannel("admin", "GUILD_TEXT");
    await server.createPublicChannel("lobby", "GUILD_VOICE");

    await server.sendMessage("admin", "Welcome to Two Rooms and a Boom!");
    await server.sendMessage(
      "admin",
      "This game requires a *minimum* of 6 players. Send *begin* in the admin chat (this one right here) to launch game. No new players will be able to join once the game begins, and a player leaving their voice channel will result in the game being terminated."
    );

    server.on("message:admin", async ({ message }) => {
      console.log("Got message", message.content);
      if (message.content == "begin") {
        await this.nominatePhase();
      }
    });

    server.on<"connect">("connect", ({ user }) => {
      if (this.phase == "Starting") this.players.add(user);
    });

    server.on<"disconnect">("disconnect", ({ user }) => {
      if (this.phase == "Starting") this.players.delete(user);
      else if (this.players.has(user))
        this.abort(user.displayName + " abandoned the game");
    });

    const prompt = await server.prompt("admin", "Hello?", [
      "Yes",
      "Oui",
      "Goodbye",
    ]);

    wait(5000).then(() => prompt.cancel("Yes"));

    const response = await prompt.getReply();

    console.log(response);
  }

  async nominatePhase() {
    this.phase = "Nominating";
    const server = this.server;
    await server.createSecretChannel("room-one", "GUILD_VOICE");
    await server.createSecretChannel("room-two", "GUILD_VOICE");

    await server.sendMessage(
      "admin",
      "Game begins! Roles have been sent, and the players locked-in."
    );
    await server.sendMessage(
      "admin",
      "Final player count: " + this.players.size
    );
    await server.sendMessage(
      "admin",
      "You have been moved into your rooms. More instructions in your private text channel."
    );
    await server.setChannelLock("admin", true);
    for (let player of this.players) {
      await server.moveToChannel(player, "room-one");
      const channelName = `${player.displayName}-private`;
      this.privateChannels.set(player, channelName);
      await server.createSecretChannel(channelName, "GUILD_TEXT");
      await server.setChannelAccess(player, channelName, true);
      await server.sendMessage(
        channelName,
        `${player}, you are The Bomber. Your objective is to end the game in the same room as the President. Find out identities by asking to show cards to one another. You can reveal either your affiliation, or your full role.`
      );
    }
    await server.setChannelLock("admin", true);
    await server.removeChannel("lobby");

    let prompts: Prompt<"Nominate">[] = [];

    for (let player of this.players) {
      const channelName = this.privateChannels.get(player);
      await server.sendMessage(
        channelName,
        `Nomination phase: The first player to be nominated as president will be elected president of that room.`
      );
      for (let otherPlayer of this.players) {
        const prompt = await server.prompt(
          channelName,
          `Nomination for president: ${otherPlayer.displayName}`,
          ["Nominate"]
        );
        prompts.push(prompt);

        prompt.getReply().then((reply) => {
          if (reply == "Nominate") {
            this.presidents[
              server.getChannelName(
                otherPlayer.voice.channel as VoiceChannel
              ) as "room-one" | "room-two"
            ] = otherPlayer;
            console.log("Nominating", otherPlayer.displayName);

            prompts.forEach((p) => {
              if (p != prompt) p.delete();
            });
          }
        });
      }

      await Promise.all(prompts.map((p) => p.getReply()));

      console.log("The nominee is", this.presidents["room-one"].displayName);
    }
  }
}

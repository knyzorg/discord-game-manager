import Discord, { VoiceChannel } from "discord.js";
import GameServer, { Prompt } from "./GameServer";
import { wait, countdown } from "./util/Timer";

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
  leaders: {
    "room-one": Discord.GuildMember;
    "room-two": Discord.GuildMember;
  };
  constructor(server: GameServer) {
    this.server = server;
    this.startPhase();
  }

  async abort(reason?: string) {
    this.phase = "Aborting";
    await this.server.sendMessage(
      "admin",
      `**Game Aborted**. Reason: ${
        reason ?? "Unknown"
      }\nRestarting resetting game in 15 seconds...`
    );
    await wait(15000);
    await this.startPhase();
  }
  async startPhase() {
    this.players = new Set();
    this.roles = new Map();
    this.privateChannels = new Map();
    this.leaders = {
      "room-one": null,
      "room-two": null,
    };
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
      switch (message.content.toLowerCase()) {
        case "begin": {
          if (this.players.size > 0 && this.phase == "Starting")
            await this.nominatePhase();
          else
            message.reply(
              `This game requires a minimum of 6 people. There are currently ${this.players.size} players in the lobby.`
            );
          break;
        }
        case "abort":
          this.abort(
            `${message.member.displayName} has manually aborted the game.`
          );
          break;
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

  assignRoles() {
    const roles: Role[] = [
      "President",
      "Bomber",
      "Sniper",
      "Target",
      "Decoy",
      "Hot Potato",
    ];
    for (let player of this.players) {
      let role = roles.pop();
      this.roles.set(player, role);
      this.server.sendMessage(
        this.privateChannels.get(player),
        `${player}, you are The ${role}. Your objective is to end the game in the same room as the President. Find out identities by asking to show cards to one another. You can reveal either your affiliation, or your full role.`
      );
    }
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
    }
    await server.setChannelLock("admin", true);
    await server.removeChannel("lobby");

    this.assignRoles();
    let prompts: Prompt<"Nominate">[] = [];

    for (let player of this.players) {
      const channelName = this.privateChannels.get(player);
      await server.sendMessage(
        channelName,
        `Nomination phase: The first player to be nominated as Leader will be elected Leader of that room.`
      );
      for (let otherPlayer of this.players) {
        if (player == otherPlayer) break;
        console.log(`Sending prompt for ${player} to nominate ${otherPlayer}`);
        const prompt = await server.prompt(
          channelName,
          `Nomination for Leader: ${otherPlayer}`,
          ["Nominate"]
        );
        prompts.push(prompt);

        console.log(`Sent prompt for ${player} to nominate ${otherPlayer}`);
        prompt.getReply().then((reply) => {
          if (reply == "Nominate") {
            this.leaders[
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
    }

    await Promise.all(prompts.map((p) => p.getReply()));
    console.log("The nominee is", this.leaders["room-one"].displayName);
    this.broadcast(
      `${this.leaders["room-one"]} has been nominated as leader of Room One.`
    );
    this.broadcast(
      `${this.leaders["room-two"]} has been nominated as leader of Room Two.`
    );

    this.sharingPhase();
  }

  async sharingPhase() {
    this.phase = "Sharing";
    await this.broadcast(
      "Sharing phase! Request to share identities with other players in your room. \n\
      Be sure to only request once the other person has agreed to share identities as requests expire after 20 seconds.\n\
      You have 3 minutes for this phase."
    );

    const countdownMessages: Promise<Discord.Message>[] = [];
    let countdownPromise = new Promise<void>(async (resolve) => {
      countdown(60 * 5, 5, async (seconds) => {
        for (let m of countdownMessages) {
          (await m).edit(`Time remaining ${seconds} seconds`);
        }
        if (seconds == 0) {
          resolve();
          for (let m of countdownMessages) {
            (await m).delete();
          }
        }
      });
      for (let player of this.players) {
        const countdownMessage = this.server.sendMessage(
          this.privateChannels.get(player),
          "*Timer loading*"
        );
        countdownMessages.push(countdownMessage);
      }
    });

    // Wait for the timer messages to send
    await Promise.all(countdownMessages);

    const shareMessages: Prompt<any>[] = [];
    for (let player of this.players) {
      for (let otherPlayer of this.players) {
        if (player == otherPlayer) break;

        let prompt = await this.server.prompt(
          this.privateChannels.get(player),
          `Trading with ${otherPlayer}`,
          ["Share Affiliation", "Share Identity"]
        );

        prompt.getReply().then(async (reply) => {
          let confirmationPrompt = await this.server.prompt(
            this.privateChannels.get(otherPlayer),
            `${player} has requested to ${reply}`,
            ["Accept", "Decline"]
          );
          shareMessages.push(confirmationPrompt);

          wait(20000).then(() => confirmationPrompt.cancel("Decline"));

          confirmationPrompt.getReply().then((reply) => {
            switch (reply) {
              case "Accept":
                {
                  this.server.sendMessage(
                    this.privateChannels.get(player),
                    `${otherPlayer} has revealed themselves to be ${this.roles.get(
                      otherPlayer
                    )}`
                  );
                  this.server.sendMessage(
                    this.privateChannels.get(otherPlayer),
                    `${player} has revealed themselves to be ${this.roles.get(
                      player
                    )}`
                  );
                }
                break;
              case "Decline": {
                this.server.sendMessage(
                  this.privateChannels.get(player),
                  `${otherPlayer} has declined to share their card with you`
                );
                break;
              }
            }
          });
        });
      }
    }
    await countdownPromise;
    for (let m of shareMessages) {
      m.delete();
    }
    console.log("Countdown complete");
  }

  async broadcast(message: string) {
    for (let [_, channel] of this.privateChannels)
      await this.server.sendMessage(channel, message);
  }
}

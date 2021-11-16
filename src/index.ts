import Discord from "discord.js";
import GameServer from "./GameServer";
import TwoRoomsOneBoomController from "./TwoRoomsOneBoomController";
import env from "dotenv";

env.config();
require("trace-unhandled/register");

const bot = new Discord.Client({
  intents:
    Discord.Intents.FLAGS.GUILD_VOICE_STATES |
    Discord.Intents.FLAGS.GUILDS |
    Discord.Intents.FLAGS.GUILD_MEMBERS |
    Discord.Intents.FLAGS.GUILD_MESSAGES,
});

bot.login(process.env.KEY);

// Setup hand-off the game server

const activeGuilds = new Set<Discord.Guild>();
bot.on("ready", (client) => {
  console.log("Ready");
  const handOff = (message: Discord.Message) => {
    if (
      message.mentions.has(client.user.id) &&
      !activeGuilds.has(message.guild)
    ) {
      console.log("Creating GameServer for", message.guildId);
      const gameServer = new GameServer(bot, message.guild);
      new TwoRoomsOneBoomController(gameServer);
    }
  };
  bot.on("message", handOff);
});

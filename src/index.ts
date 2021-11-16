import Discord from "discord.js";
import GameServer from "./GameServer";
import env from "dotenv";
env.config();

const bot = new Discord.Client({
  intents:
    Discord.Intents.FLAGS.GUILD_VOICE_STATES |
    Discord.Intents.FLAGS.GUILDS |
    Discord.Intents.FLAGS.GUILD_MEMBERS |
    Discord.Intents.FLAGS.GUILD_MESSAGES,
});

bot.login(process.env.KEY);

// Setup hand-off the game server
bot.on("ready", (client) => {
  console.log("Ready");
  const handOff = (message: Discord.Message) => {
    console.log("Handing off...");
    if (message.mentions.has(client.user.id)) {
      new GameServer(bot, message.guild);
      bot.off("message", handOff);
      console.log("Hand-off complete");
    }
  };
  bot.on("message", handOff);
});

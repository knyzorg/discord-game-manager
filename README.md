# Discord Game Manager

Discord Game Manager is a a Discord bot that has everything you need to run social deduction style games in Discord servers.

## Games Included

- [Two Rooms One Boom](https://boardgamegeek.com/boardgame/134352/two-rooms-and-boom)
- _Contributions welcome for other games!_

## Architecture

The whole system is built on top of [Discord.js](https://discord.js.org/) with a set of abstractions in [GameServer](./src/GameServer.ts) to facilitate complex interactions. With time, the GameServer will grow into it's own package as the abstract stops to leak Discordjs internal state to provide a more constrained and easier to use framework to focus solely on game development.

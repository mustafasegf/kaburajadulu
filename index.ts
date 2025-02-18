import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  VoiceChannel,
  type ApplicationCommandOptionData,
  type CacheType,
  type PermissionResolvable,
} from "discord.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    // GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

export type Commands = {
  name: string;
  description: string;
  options?: ApplicationCommandOptionData[];
  defaultMemberPermissions?: PermissionResolvable;
  run: (context: CommandContext) => void | Promise<unknown>;
};

export type CommandContext = {
  interaction: ChatInputCommandInteraction<CacheType>;
  client: Client;
};

const db: Record<string, { channel: string; category: string }> = {};
const ids: Record<string, VoiceChannel> = {};

const commands: Commands[] = [
  {
    name: "ping",
    description: "Replies with Pong!",
    run: async ({ interaction }) => {
      await interaction.reply("Pong!");
    },
  },
  {
    name: "configure",
    description:
      "configure on which channel should the bot create new voice channels",
    options: [
      {
        name: "channel",
        description:
          "The channel where the bot should create new voice channels",
        type: ApplicationCommandOptionType.Channel,
        required: true,
      },
      {
        name: "category",
        description:
          "The category where the bot should create new voice channels",
        type: ApplicationCommandOptionType.Channel,
        required: true,
      },
    ],
    run: async ({ interaction }) => {
      const channel = interaction.options.getChannel("channel")!;
      const category = interaction.options.getChannel("category")!;
      // need to filter out if the channel isnt a voice channel
      if (channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({
          content: "Please provide a voice channel",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (category.type !== ChannelType.GuildCategory) {
        await interaction.reply({
          content: "Please provide a category channel",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      db[interaction.guildId!] = {
        channel: channel.id,
        category: category.id,
      };

      await interaction.reply({
        content: "Configured!",
        flags: [MessageFlags.Ephemeral],
      });
    },
  },
];

async function main() {
  client.on("ready", async (client) => {
    await client.application.commands.set(commands);

    const { username, tag } = client.user;
    console.log(`Bot has been logged in as ${username} (${tag})!`);
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction instanceof ChatInputCommandInteraction) {
      const command = commands.find((c) => c.name === interaction.commandName)!;

      try {
        await command?.run({ interaction, client });
      } catch (e) {
        console.error(e);
      }
    }
  });

  client.on("voiceStateUpdate", async (oldState, newState) => {
    if (oldState.member?.user.bot) return;
    // we want to check if there's any user joined a particular vc, if yes then create a new one, then move that member there.
    // check from const db
    if (db[newState.guild.id] !== undefined) {
      // create a new vc
      const channel = await newState.guild.channels.create({
        name: `${newState.member!.user.username}'s Channel`,
        type: ChannelType.GuildVoice,
        parent: db[newState.guild.id].category,
        permissionOverwrites: [
          {
            id: newState.member!.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
      });

      ids[newState.member!.id] = channel;

      // move the member to the new vc
      newState.member?.voice.setChannel(channel);

      return;
    }

    // check if the event is in ids
    // if yes, then check if the channel is empty. if yes, then delete the channel
    if (oldState.channel?.id === ids[oldState.member!.id]?.id) {
      if (oldState.channel?.members.size === 0) {
        await oldState.channel.delete();
      }
    }
  });

  client.on("error", (error: Error) => {
    console.error("Unexpected error while logging into Discord.");
    console.error(error);
    return;
  });

  client.login(process.env.DC_TOKEN);
}

Promise.allSettled([main()]).catch((e) => console.error(e));

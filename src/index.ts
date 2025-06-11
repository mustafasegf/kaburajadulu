import {
  ApplicationCommandOptionType,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  VoiceChannel,
  EmbedBuilder,
  TextChannel,
  type ApplicationCommandOptionData,
  type CacheType,
  type PermissionResolvable,
  Events,
  VoiceState,
  type OmitPartialGroupDMChannel,
  Message,
} from "discord.js";
import * as dbService from "./db";

// Client setup with required intents
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers, // Needed to get member roles
    GatewayIntentBits.MessageContent,
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

// TODO: create command for remove config, add command to get statistic
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
      "Configure on which channel should the bot create new voice channels",
    options: [
      {
        name: "channel",
        description:
          "The channel where the bot should create new voice channels",
        type: ApplicationCommandOptionType.Channel,
        required: true,
      }
    ],
    run: async ({ interaction }) => {
      const channel = interaction.options.getChannel("channel")!;

      if (channel.type !== ChannelType.GuildStageVoice) {
        await interaction.reply({
          content: `Please provide a voice channel, the chael type are ${channel.type}`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      dbService.addChannel({
        id: interaction.guildId!,
        channelId: channel.id,
        serverName: interaction.guild!.name,
        serverId: interaction.guild!.id,
        channelName: channel.name || "unknown name",
      });

      await interaction.reply({
        content: `Configured Channel ${channel.name} on server ${interaction.guild?.name}!`,
        flags: [MessageFlags.Ephemeral],
      });
    },
  },
  {
    name: "getconfig",
    description: "Get configuration on this server",
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {
      const channels = dbService.listChannelFromServerId(interaction.guild!.id)
      const content = channels.map((channel, i) => `${i + 1}. ${channel.channelName}`).join("\n");

      await interaction.reply({
        content,
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
  {
    name: "sticky",
    description: "setup a sticky messge for this channel",
    defaultMemberPermissions: ["ManageChannels"],
    options: [
      {
        name: "message",
        description:
          "The sticky message",
        type: ApplicationCommandOptionType.String,
        required: true,
      }
    ],
    run: async ({ interaction }) => {
      const message = interaction.options.getString("message")!;

      const channel = interaction.guild?.channels.cache.get(interaction.channelId)
      if (!channel || !channel.isSendable()) {
        await interaction.reply({
          content: "Someting is wrong",
          flags: [MessageFlags.Ephemeral],
        })
        return
      }

      const oldSticky = dbService.getStickyMessage(interaction.channelId, interaction.guildId || "unknown")
      if (oldSticky) {
        channel.messages.delete(oldSticky.lastMessageId)
        dbService.deleteStickyMessage(interaction.channelId, interaction.guildId || "unknown")
      }

      const res = await channel.send(message)

      dbService.addStickyMessage({
        channelId: interaction.channelId,
        serverName: interaction.guild!.name,
        serverId: interaction.guildId || "unknown",
        // @ts-ignore
        channelName: interaction!.channel?.name || "unknown",
        lastMessageId: res.id,
        message
      })
      await interaction.reply({
        content: "Sticky Message Successfully Configured",
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
  {
    name: "deletesticky",
    description: "delete the sticky messge for this channel",
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {

      const channel = interaction.guild?.channels.cache.get(interaction.channelId)
      if (!channel || !channel.isSendable()) {
        await interaction.reply({
          content: "Someting is wrong",
          flags: [MessageFlags.Ephemeral],
        })
        return
      }

      dbService.deleteStickyMessage(
        interaction.channelId,
        interaction.guildId || "unknown",
      )

      await interaction.reply({
        content: "Sticky Message Successfully Deleted",
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
  {
    name: "dm",
    description: "dm a message to all the roles",
    defaultMemberPermissions: ["ManageChannels"],
    options: [
      {
        name: "role",
        description:
          "The role",
        type: ApplicationCommandOptionType.Role,
        required: true,
      },
      {
        name: "message",
        description:
          "The sticky message",
        type: ApplicationCommandOptionType.String,
        required: true,
      }
    ],
    run: async ({ interaction }) => {
      const role = interaction.options.getRole("role")!;
      const message = interaction.options.getString("message")!;

      if ("members" in role) {
        const users = Array.from(role.members.values())

        const content = "Sending message: " + message

        await interaction.reply({
          content,
          flags: [MessageFlags.Ephemeral],
        })

        for (const user of users) {
          user.send(message)
        }

        return
      }

      await interaction.reply({
        content: "Role isn't a user role",
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
];


async function handleStageActivity(oldState: VoiceState, newState: VoiceState, channel: dbService.Channel) {
  const channelId = oldState.channelId || newState.channelId!;
  const ch = oldState.channel || newState.channel!
  const guild = oldState.guild || newState.guild;
  const member = oldState.member || newState.member!

  const joined = !oldState.channelId

  const msg = joined ? "joined to" : "left from"

  console.log(member.user.displayName, msg, ch.name, "from", guild.name)

  // TODO: put all of this into a tx
  let session = dbService.getActiveStageSession(channelId, guild.id)
  if (!session) {
    session = dbService.addStageSession({
      channelId: ch.id,
      serverId: guild.id,
      uniqueUserCount: 0,
    })
  }

  let user = dbService.getUserForSession(session.id, member.user.id)
  if (!user) {
    user = dbService.addStageUser({
      sessionId: session.id,
      userId: member.id,
      username: member.user.username,
      displayname: member.user.displayName,
      joinTime: new Date(),
    })
  }

  const now = new Date()
  if (joined) {
    dbService.updateSessionUniqueUserCount(session.id, session.uniqueUserCount + 1)
  } else {
    if (session.uniqueUserCount <= 0) {
      dbService.endStageSession(session.id, now)
    }
    dbService.markUserLeave(session.id, member.user.id, new Date(), now.getTime() - user.joinTime.getTime())
  }
}

async function handleStickyMessage(event: OmitPartialGroupDMChannel<Message<boolean>>) {
  const message = dbService.getStickyMessage(event.channelId, event.guildId!)
  if (!message) return

  const channel = event.guild?.channels.cache.get(event.channelId)
  if (!channel || !channel.isSendable()) {
    return
  }

  channel.messages.delete(message.lastMessageId)

  const res = await channel.send(message.message)

  dbService.updateStickyMessageLastId(
    event.channelId,
    event.guildId || "unknown",
    res.id,
  )
}

async function main() {
  client.on("ready", async (client) => {
    await client.application.commands.set(commands);

    const { username, tag } = client.user;
    console.log(`Bot has been logged in as ${username} (${tag})!`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction instanceof ChatInputCommandInteraction) {
      const command = commands.find((c) => c.name === interaction.commandName)!;

      try {
        await command?.run({ interaction, client });
      } catch (e) {
        console.error(e);
      }
    }
  });

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    if (oldState.member?.user.bot) return;

    const channelId = oldState.channelId || newState.channelId;
    const serverId = oldState.guild.id || newState.guild.id;
    const channel = dbService.getChannelFromChannelAndServer(channelId!, serverId)

    if (!channel) return;

    handleStageActivity(oldState, newState, channel)
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    handleStickyMessage(message)
  })

  client.on("error", (error: Error) => {
    console.error("Unexpected error while logging into Discord.");
    console.error(error);
    return;
  });

  client.login(process.env.DC_TOKEN);
}

Promise.allSettled([main()]).catch((e) => console.error(e));

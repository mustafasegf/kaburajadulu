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
  GuildMember,
  type VoiceBasedChannel,
  AttachmentBuilder,
} from "discord.js";
import * as dbService from "./db";
import { db } from "./db"
import * as schema from "./schema";

import pino from "pino";
import { bucket } from "./utils";
import { and, desc, eq, isNull } from "drizzle-orm";

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

const logger = pino({
  transport: {
    target: 'pino-pretty'
  },
})

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
    name: "track",
    description:
      "Configure on which channel should the bot track user activity",
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

      if (channel.type !== ChannelType.GuildStageVoice && channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({
          content: `Please provide a voice channel, the chael type are ${channel.type}`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const chn = channel as VoiceBasedChannel

      dbService.addChannel({
        id: interaction.guildId!,
        channelId: channel.id,
        serverName: interaction.guild!.name,
        serverId: interaction.guild!.id,
        channelName: channel.name || "unknown name",
      });

      await interaction.guild?.channels.fetch()

      const members = Array.from(chn?.members.values())

      let session = dbService.getActiveStageSession(channel.id, interaction.guild!.id)
      if (!session) {
        session = dbService.addStageSession({
          channelId: channel.id,
          serverId: interaction.guild!.id,
          uniqueUserCount: members.length,
        })
      }

      if (members) {
        for (const member of members.values()) {
          dbService.addStageUser({
            sessionId: session.id,
            userId: member.id,
            username: member.user.username,
            displayname: member.user.displayName,
            joinTime: new Date(),
          })
        }
      }

      db.insert(schema.auditLog).values({
        channelId: interaction.channelId,
        // @ts-ignore
        channelName: interaction?.channel?.name || "unknown",
        serverId: interaction.guildId || "unknown",
        serverName: interaction.guild!.name,
        userId: interaction.user.id,
        username: interaction.user.username,
        displayname: interaction.user.displayName,
        command: interaction.commandName,
        action: { channel: channel.name },
      }).onConflictDoNothing()
        .execute()

      await interaction.reply({
        content: `Configured Channel ${channel.name} on server ${interaction.guild?.name}!`,
        flags: [MessageFlags.Ephemeral],
      });
    },
  },
  {
    name: "endtrack",
    description:
      "End tracking session",
    options: [
      {
        name: "channel",
        description:
          "The channel where the bot should end the tracking session",
        type: ApplicationCommandOptionType.Channel,
        required: true,
      }
    ],
    run: async ({ interaction }) => {
      const channel = interaction.options.getChannel("channel")!;

      if (channel.type !== ChannelType.GuildStageVoice && channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({
          content: `Please provide a voice channel, the chael type are ${channel.type}`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const chn = channel as VoiceBasedChannel

      await interaction.guild?.channels.fetch()

      const members = Array.from(chn?.members.values())

      let session = dbService.getActiveStageSession(channel.id, interaction.guild!.id)
      if (!session) {
        session = dbService.addStageSession({
          channelId: channel.id,
          serverId: interaction.guild!.id,
          uniqueUserCount: members.length,
        })
      }

      const dbMembers = db.select()
        .from(schema.stageUsers)
        .where(and(
          eq(schema.stageUsers.sessionId, session.id),
          isNull(schema.stageUsers.leaveTime)
        )).all()

      const memberMap: Record<string, dbService.StageUser> = {}

      for (const member of dbMembers) {
        memberMap[member.userId] = member
      }

      console.log(memberMap)

      const now = new Date()
      if (members) {
        for (const member of members.values()) {
          const dbMember = memberMap[member.id]
          if (!dbMember) continue
          dbService.markUserLeave(session.id, member.user.id, new Date(), now.getTime() - dbMember.joinTime.getTime())
        }
      }

      dbService.updateSessionUniqueUserCount(session.id, 0)
      dbService.endStageSession(session.id, now)


      db.insert(schema.auditLog).values({
        channelId: interaction.channelId,
        // @ts-ignore
        channelName: interaction?.channel?.name || "unknown",
        serverId: interaction.guildId || "unknown",
        serverName: interaction.guild!.name,
        userId: interaction.user.id,
        username: interaction.user.username,
        displayname: interaction.user.displayName,
        command: interaction.commandName,
        action: { channel: channel.name },
      }).onConflictDoNothing()
        .execute()

      await interaction.reply({
        content: `Ended tracking on channel ${channel.name} on server ${interaction.guild?.name}!`,
        flags: [MessageFlags.Ephemeral],
      });
    },
  },
  {
    name: "removetrack",
    description: "Remove tracking on voice channel",
    options: [
      {
        name: "channel",
        description:
          "The channel where the bot tracks",
        type: ApplicationCommandOptionType.Channel,
        required: true,
      }
    ],
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {
      const channel = interaction.options.getChannel("channel")!;

      const channels = dbService.listChannelFromServerId(interaction.guild!.id)
      const content = channels.map((channel, i) => `${i + 1}. ${channel.channelName}`).join("\n");

      await interaction.reply({
        content,
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
  {
    name: "gettrack",
    description: "Get configuration on this server",
    options: [
      {
        name: "channel",
        description:
          "The channel where the bot check the statistics",
        type: ApplicationCommandOptionType.Channel,
        required: false,
      }
    ],
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {

      const channel = interaction.options.getChannel("channel");
      if (!channel) {
        const channels = dbService.listChannelFromServerId(interaction.guild!.id)

        if (channels.length === 0) {
          await interaction.reply({
            content: "No channel being tracked",
            flags: [MessageFlags.Ephemeral],
          })
          return
        }

        const content = channels.map((channel, i) => `${i + 1}. ${channel.channelName}`).join("\n");

        await interaction.reply({
          content,
          flags: [MessageFlags.Ephemeral],
        })
        return
      }

      const data = await db.query.stageSessions.findMany({
        with: {
          users: true,
        },
        orderBy: desc(schema.stageSessions.createdAt),
        limit: 5,
      });

      function convertToCSV(sessions: typeof data) {
        const headers = [
          "Session ID",
          "Server ID",
          "Channel ID",
          "Start Time",
          "End Time",
          "Is Active",
          "Unique User Count",
          "User ID",
          "Username",
          "Display Name",
          "Join Time",
          "Leave Time",
          "Total Time (ms)"
        ];

        const rows = [headers.join(",")];

        sessions.forEach(session => {
          if (session.users.length === 0) {
            // Session with no users
            rows.push([
              session.id,
              session.serverId,
              session.channelId,
              session.startTime?.toISOString() || "",
              session.endTime?.toISOString() || "",
              session.isActive,
              session.uniqueUserCount,
              "", "", "", "", "", ""
            ].join(","));
          } else {
            // Session with users
            session.users.forEach(user => {
              rows.push([
                session.id,
                session.serverId,
                session.channelId,
                session.startTime?.toISOString() || "",
                session.endTime?.toISOString() || "",
                session.isActive,
                session.uniqueUserCount,
                user.userId,
                `"${user.username}"`, // Wrap in quotes for CSV safety
                `"${user.displayname}"`,
                user.joinTime?.toISOString() || "",
                user.leaveTime?.toISOString() || "",
                user.totalTimeMs
              ].join(","));
            });
          }
        });

        return rows.join("\n");
      }

      const csvContent = convertToCSV(data);
      const attachment = new AttachmentBuilder(Buffer.from(csvContent), {
        name: `${channel.name}-session.csv`
      });

      await interaction.reply({
        content: `Here are the last 5 stage sessions for ${channel.name}`,
        files: [attachment],
        flags: [MessageFlags.Ephemeral],
      });
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

      db.insert(schema.auditLog).values({
        channelId: interaction.channelId,
        // @ts-ignore
        channelName: interaction?.channel?.name || "unknown",
        serverId: interaction.guildId || "unknown",
        serverName: interaction.guild!.name,
        userId: interaction.user.id,
        username: interaction.user.username,
        displayname: interaction.user.displayName,
        command: interaction.commandName,
        action: { channel: channel.name, message },
      }).onConflictDoNothing()
        .execute()

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

      db.insert(schema.auditLog).values({
        channelId: interaction.channelId,
        // @ts-ignore
        channelName: interaction?.channel?.name || "unknown",
        serverId: interaction.guildId || "unknown",
        serverName: interaction.guild!.name,
        userId: interaction.user.id,
        username: interaction.user.username,
        displayname: interaction.user.displayName,
        command: interaction.commandName,
      }).onConflictDoNothing()
        .execute()

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
        await interaction!.guild!.members!.fetch()

        const users = Array.from(role.members.values())
        const content = "Sending message: " + message + "\n to " + users.length + " users"

        const scheduler = bucket(10, 1_000)

        await interaction.reply({
          content,
          flags: [MessageFlags.Ephemeral],
        })

        // TODO: create utils to extract common guikd and server info
        db.insert(schema.auditLog).values({
          channelId: interaction.channelId,
          // @ts-ignore
          channelName: interaction?.channel?.name || "unknown",
          serverId: interaction.guildId || "unknown",
          serverName: interaction.guild!.name,
          userId: interaction.user.id,
          username: interaction.user.username,
          displayname: interaction.user.displayName,
          command: interaction.commandName,
          action: { role: role.name, message },
        }).onConflictDoNothing()
          .execute()

        for (const user of users) {
          scheduler(
            () => user.send(message)
              .then(_msg => logger.info(`Successfully sent message to ${user.displayName} (${user.user.username})`))
              .catch(err => logger.error(err))
          )
        }

        return
      }

      await interaction.reply({
        content: "Role isn't a user role",
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
  // TODO: make audit log pagination with button
  {
    name: "audit",
    description: "Check the audit log of what command being run",
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {
      const logs = db.select().from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.channelId, interaction.channelId),
            eq(schema.auditLog.serverId, interaction.guildId || "unknown"),
          )
        )
        .orderBy(desc(schema.auditLog.createdAt)).all()

      if (logs.length === 0) {
        logger.debug("No audit log available")
        await interaction.reply({
          content: "No audit log available",
          flags: [MessageFlags.Ephemeral],
        })

        return
      }

      const content = logs.map((log, i) => `${i + 1}. ${log.displayname} (${log.username}) do \`${log.command}\` with ${JSON.stringify(log.action)} at ${log.createdAt}`).join('\n')

      await interaction.reply({
        content,
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
  const ignoreEvent = oldState.channelId && newState.channelId // if both exist, then it's not leave nor join

  if (ignoreEvent) {
    return
  }

  const joined = !oldState.channelId

  const msg = joined ? "joined to" : "left from"

  logger.info(`${member.user.displayName} ${msg} ${ch.name} from ${guild.name}`)

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
    dbService.markUserLeave(session.id, member.user.id, now, now.getTime() - user.joinTime.getTime())
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
    logger.info(`Bot has been logged in as ${username} (${tag})!`)
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction instanceof ChatInputCommandInteraction) {
      const command = commands.find((c) => c.name === interaction.commandName)!;

      try {
        await command?.run({ interaction, client });
      } catch (e) {
        logger.error(e)
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
    logger.error("Unexpected error while logging into Discord.");
    logger.error(error);
    return;
  });

  client.login(process.env.DC_TOKEN);
}

Promise.allSettled([main()]).catch((e) => logger.error(e));

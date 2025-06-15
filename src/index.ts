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
import { bucket, Mutex } from "./utils";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as chrono from 'chrono-node';

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

      logger.info(`Start tracking on ${channel.name}`)

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

      logger.info(`Ended tracking on ${channel.name}`)

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

      logger.info(`Remove tracking from ${channel.name}`)

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

      const sticky = dbService.addStickyMessage({
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

      logger.info(`Added sticky message on ${sticky?.channelName}`)

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

      const sticky = dbService.deleteStickyMessage(
        interaction.channelId,
        interaction.guildId || "unknown",
      )

      if (sticky) {
        channel.messages.delete(sticky.lastMessageId)
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
        action: { channel: channel.name }
      }).onConflictDoNothing()
        .execute()

      logger.info(`Deleted sticky message on ${sticky?.channelName}`)

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

        // @ts-ignore
        logger.info(`Ended tracking on ${interaction?.channel?.name || "unknown"}`)

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
  {
    name: "schedule",
    description: "Add scheduled message",
    options: [
      {
        name: "message",
        description:
          "The sticky message",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "time",
        description:
          "Which time to send the message",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "channel",
        description:
          "The channel where the scheduled message is configured",
        type: ApplicationCommandOptionType.Channel,
        required: false,
      },
      {
        name: "repeating",
        description:
          "How should the message repeat",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: "Daily", value: "Daily" },
          { name: "Weekly", value: "Weekly" },
          { name: "Monthly", value: "Monthly" },
          { name: "Final Week Of The Month", value: "Final Week" },
        ],
      }
    ],
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {
      const message = interaction.options.getString("message")!;
      const time = interaction.options.getString("time")!;
      const channel = interaction.options.getChannel("channel") || interaction.guild?.channels.cache.get(interaction.channelId)!;
      const repeating = interaction.options.getString("repeating");

      if (!channel || "isSendable" in channel && !channel.isSendable()) {
        await interaction.reply({
          content: "Someting is wrong",
          flags: [MessageFlags.Ephemeral],
        })
        return
      }

      const date = chrono.parseDate(time)
      if (!date) {
        await interaction.reply({
          content: "Invalid time format",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      date.setSeconds(0, 0)

      if (date < new Date()) {
        await interaction.reply({
          content: "The time can't be in the past",
          flags: [MessageFlags.Ephemeral],
        });

        return;
      }

      const schedule = db.insert(schema.schedule)
        .values({
          channelId: interaction.channelId,
          // @ts-ignore
          channelName: channel?.name || "unknown",
          serverId: interaction.guildId || "unknown",
          serverName: interaction.guild!.name,
          message,
          repeating,
          time: date,
        })
        .returning()
        .get()

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

      logger.info(`Schedule message successfully configured on ${schedule.channelName}`)

      await interaction.reply({
        content: "Schedule Message Successfully Configured",
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
  {
    name: "getschedule",
    description: "Get scheduled message",
    options: [
      {
        name: "channel",
        description:
          "The channel where the scheduled message is configured",
        type: ApplicationCommandOptionType.Channel,
        required: false,
      }
    ],
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {
      let channel = interaction.options.getChannel("message") || { id: interaction.channelId };

      const schedules = db.select()
        .from(schema.schedule)
        .where(
          and(
            eq(schema.schedule.channelId, channel.id),
            eq(schema.schedule.serverId, interaction.guildId || "unknown"),
          )
        )
        .all()

      if (schedules.length === 0) {
        logger.debug("No schedule message available")
        await interaction.reply({
          content: "No schedule message available",
          flags: [MessageFlags.Ephemeral],
        })

        return
      }

      const content = schedules.map((schedule, i) => `${i + 1}. ${schedule.channelName} @(${schedule.time})\n${schedule.message}`).join('\n')

      await interaction.reply({
        content,
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
  {
    name: "getallschedule",
    description: "Get all scheduled message in the server",
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {

      const schedules = db.select()
        .from(schema.schedule)
        .where(
          and(
            eq(schema.schedule.serverId, interaction.guildId || "unknown"),
          )
        )
        .all()

      if (schedules.length === 0) {
        logger.debug("No schedule message available")
        await interaction.reply({
          content: "No schedule message available",
          flags: [MessageFlags.Ephemeral],
        })

        return
      }

      const content = schedules.map((schedule, i) => `${i + 1}. ${schedule.channelName} @(${schedule.time})\n${schedule.message}`).join('\n')

      await interaction.reply({
        content,
        flags: [MessageFlags.Ephemeral],
      })
    },
  },
  {
    name: "deleteschedule",
    description: "Delete scheduled message",
    options: [
      {
        name: "channel",
        description:
          "The channel where the scheduled message is configured",
        type: ApplicationCommandOptionType.Channel,
        required: false,
      },
      {
        name: "order",
        description:
          "Which schedule to delete. use /getschedule to check which schedule to available",
        type: ApplicationCommandOptionType.Number,
        required: false,
      }
    ],
    defaultMemberPermissions: ["ManageChannels"],
    run: async ({ interaction }) => {
      const channel = interaction.options.getChannel("message") || { id: interaction.channelId, name: interaction.guild?.name };
      const order = interaction.options.getNumber("order")

      const schedules = db.select()
        .from(schema.schedule)
        .where(
          and(
            eq(schema.schedule.channelId, channel.id),
            eq(schema.schedule.serverId, interaction.guildId || "unknown"),
          )
        )
        .all()

      if (schedules.length === 0) {
        await interaction.reply({
          content: "No schedule message available",
          flags: [MessageFlags.Ephemeral],
        })

        return
      }

      if (schedules.length > 1 && !order) {

        const content = schedules.map((schedule, i) => `${i + 1}. ${schedule.channelName} @(${schedule.time})\n${schedule.message}`).join('\n')
        await interaction.reply({
          content: "There's more than one scheduled message on this channel. Please add order to the command\n" + content,
          flags: [MessageFlags.Ephemeral],
        })

        return
      }

      if (order && order - 1 > schedules.length) {
        await interaction.reply({
          content: "Order is greater than the amount of scheduled message",
          flags: [MessageFlags.Ephemeral],
        })

        return
      }

      const schedule = db.delete(schema.schedule)
        .where(
          and(
            eq(schema.schedule.channelId, channel.id),
            eq(schema.schedule.serverId, interaction.guildId || "unknown"),
            eq(schema.schedule.id, schedules[(order || 1) - 1].id),
          )
        )
        .returning()
        .get()


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

      const content = schedules.filter((_schedule, i) => i != ((order || 1) - 1)).map((schedule, i) => `${i + 1}. ${schedule.channelName} @(${schedule.time})\n${schedule.message}`).join('\n')

      if (content) {
        await interaction.reply({
          content: `Deleted scheduled message on ${schedule?.channelName} @${schedule?.time}}\n` + content,
          flags: [MessageFlags.Ephemeral],
        })
      }
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

  try {
    channel.messages.delete(message.lastMessageId)
  } catch (e) {
    logger.error("can't delete message", e)
  }

  const res = await channel.send(message.message)

  dbService.updateStickyMessageLastId(
    event.channelId,
    event.guildId || "unknown",
    res.id,
  )
}

function scheduleWorker() {
  logger.info("Worker started");
  const currentTime = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  logger.info(`Current time is ${currentTime}`);

  // loop all settings in every minute. Check if the time is the same as the current time and send the message
  setInterval(async () => {

    const currentTime = new Date()
    currentTime.setSeconds(0, 0)
    const schedules = db
      .select()
      .from(schema.schedule)
      .where(eq(schema.schedule.time, currentTime))
      .all()

    for (const schedule of schedules) {
      const guild = await client.guilds.fetch(schedule.serverId);
      const channel = await guild.channels.fetch(schedule.channelId);

      if (!channel || !("send" in channel)) {
        logger.warn(`Channel ${schedule.channelName} don't have send functionality`)

        continue
      }

      await channel.send(schedule.message)
      logger.info(`Sending schedule message to ${schedule.channelName}`)


      if (schedule.repeating) {
        if (schedule.repeating === "Daily") {
          schedule.time.setDate(schedule.time.getDate() + 1)

          db
            .update(schema.schedule)
            .set({ time: schedule.time })
            .where(eq(schema.schedule.id, schedule.id))
            .execute()
        } else if (schedule.repeating === "Weekly") {
          schedule.time.setDate(schedule.time.getDate() + 7)

          db
            .update(schema.schedule)
            .set({ time: schedule.time })
            .where(eq(schema.schedule.id, schedule.id))
            .execute()
        } else if (schedule.repeating === "Monthly") {
          schedule.time.setMonth(schedule.time.getMonth() + 1)

          db
            .update(schema.schedule)
            .set({ time: schedule.time })
            .where(eq(schema.schedule.id, schedule.id))
            .execute()
        } else if (schedule.repeating === "Final Week") {
          const targetWeekday = schedule.time.getDay();

          // Move to next month
          schedule.time.setMonth(schedule.time.getMonth() + 1);

          // Get the last day of next month
          const lastDayOfMonth = new Date(schedule.time.getFullYear(), schedule.time.getMonth() + 1, 0).getDate();

          // Set to last day of the month first
          schedule.time.setDate(lastDayOfMonth);

          // Calculate how many days to go back to find the last occurrence of target weekday
          const daysToSubtract = (schedule.time.getDay() - targetWeekday + 7) % 7;

          // Move back to the last occurrence of the target weekday
          schedule.time.setDate(schedule.time.getDate() - daysToSubtract);

          db
            .update(schema.schedule)
            .set({ time: schedule.time })
            .where(eq(schema.schedule.id, schedule.id))
            .execute()
        } else {
          logger.warn(`Schedule not valid: ${schedule.repeating}`)
        }
      } else {
        db.delete(schema.schedule)
          .where(eq(schema.schedule.id, schedule.id))
          .execute()
      }
    }

  }, 60 * 1000);
}

function stickyMessageWorker() {

  setInterval(async () => {
    const now = Date.now();
    const updates = [...pendingStickyUpdates.entries()];

    logger.debug(`Worker checking ${updates.length} pending sticky updates`);

    for (const [channelKey, updateData] of updates) {
      const { message, timestamp, sticky, lastProcessed } = updateData;
      const lastRun = channelCooldowns.get(channelKey) || lastProcessed;

      if (now - lastRun >= COOLDOWN_MS) {
        try {
          logger.info(`Worker processing sticky update for channel ${message.channelId}`);

          channelCooldowns.set(channelKey, now);

          await handleStickyMessage(message);

          pendingStickyUpdates.delete(channelKey);

          logger.info(`Worker completed sticky update for channel ${message.channelId}`);
        } catch (e) {
          logger.error(`Worker error processing sticky for channel ${message.channelId}:`, e);
        }
      }
    }
  }, 2_500);
}


const channelCooldowns = new Map();
const pendingStickyUpdates = new Map();
const COOLDOWN_MS = 2_500;

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

    const channelId = message.channelId;
    const serverId = message.guild?.id;

    if (!serverId) return;

    const sticky = dbService.getStickyMessage(channelId, serverId)
    if (!sticky) return;

    const channelKey = `${serverId}-${channelId}`;
    const now = Date.now();
    const lastRun = channelCooldowns.get(channelKey);

    logger.debug("cooldown " + channelCooldowns.values())

    if (lastRun) {
      logger.debug(`Time since last run: ${now - lastRun}ms`);
    }

    // Skip if within cooldown period
    if (lastRun && (now - lastRun) < COOLDOWN_MS) {
      logger.debug(`Skipping handleStickyMessage for channel ${channelId} - within cooldown`);
      return;
    }

    try {
      channelCooldowns.set(channelKey, now);
      pendingStickyUpdates.set(channelKey, {
        message,
        timestamp: now,
        sticky,
        lastProcessed: lastRun || 0
      });

      await handleStickyMessage(message);
      pendingStickyUpdates.delete(channelKey);
    } catch (e) {
      logger.error(e);
    }
  });

  client.on("error", (error: Error) => {
    logger.error("Unexpected error while logging into Discord.");
    logger.error(error);
    return;
  });

  client.login(process.env.DC_TOKEN);
}

Promise.allSettled(
  [
    main(),
    scheduleWorker(),
    stickyMessageWorker(),
  ]
)
  .catch((e) => logger.error(e));

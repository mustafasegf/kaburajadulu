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
        channelName: interaction!.channel!.name || "unknown",
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
  }
  // {
  //   name: "stage-stats",
  //   description: "Get statistics about the tracked stage",
  //   options: [
  //     {
  //       name: "channel",
  //       description: "The channel to send stats to",
  //       type: ApplicationCommandOptionType.Channel,
  //       required: true
  //     },
  //     {
  //       name: "session",
  //       description: "Session ID (leave empty for current/latest session)",
  //       type: ApplicationCommandOptionType.String,
  //       required: false
  //     }
  //   ],
  //   run: async ({ interaction }) => {
  //     const channel = interaction.options.getChannel("channel") as TextChannel;
  //     const sessionId = interaction.options.getString("session") || activeSessionId;
  //     
  //     if (channel.type !== ChannelType.GuildText) {
  //       await interaction.reply({
  //         content: "Please provide a text channel",
  //         flags: [MessageFlags.Ephemeral],
  //       });
  //       return;
  //     }
  //     
  //     await interaction.deferReply({ ephemeral: true });
  //     
  //     if (!sessionId) {
  //       await interaction.editReply("No active stage session found.");
  //       return;
  //     }
  //     
  //     // Get session data
  //     const session = dbService.db
  //       .select()
  //       .from(dbService.db.schema.stageSessions)
  //       .where(dbService.eq(dbService.db.schema.stageSessions.id, sessionId))
  //       .get();
  //     
  //     if (!session) {
  //       await interaction.editReply(`No session found with ID: ${sessionId}`);
  //       return;
  //     }
  //     
  //     // Get user data
  //     const users = dbService.getUsersForSession(sessionId);
  //     
  //     if (users.length === 0) {
  //       await interaction.editReply("No user data available for this session.");
  //       return;
  //     }
  //     
  //     // Calculate average time spent (in minutes)
  //     const totalTimeSpent = users.reduce((sum, user) => sum + user.totalTimeMs, 0);
  //     const avgTimeSpentMinutes = users.length > 0 
  //       ? Math.round((totalTimeSpent / users.length) / 60000 * 10) / 10 
  //       : 0;
  //     
  //     // Sort users by time spent
  //     const userTimeData = users.map(user => ({
  //       id: user.id,
  //       userId: user.userId,
  //       username: user.username,
  //       timeMinutes: Math.round(user.totalTimeMs / 60000 * 10) / 10
  //     })).sort((a, b) => b.timeMinutes - a.timeMinutes);
  //     
  //     // Create stats embed
  //     const statsEmbed = new EmbedBuilder()
  //       .setTitle("Stage Activity Statistics")
  //       .setDescription(`Stats for Stage ID: ${STAGE_ID}`)
  //       .setColor(0x0099FF)
  //       .addFields(
  //         { name: 'Total Unique Users', value: session.uniqueUserCount.toString(), inline: true },
  //         { name: 'Average Time Spent', value: `${avgTimeSpentMinutes} minutes`, inline: true },
  //         { name: 'Session Status', value: session.isActive ? 'Active' : 'Ended', inline: true },
  //         { name: 'Start Time', value: new Date(session.startTime).toLocaleString(), inline: true }
  //       );
  //       
  //     if (session.endTime) {
  //       statsEmbed.addFields({ 
  //         name: 'End Time', 
  //         value: new Date(session.endTime).toLocaleString(), 
  //         inline: true 
  //       });
  //       
  //       // Calculate total duration if ended
  //       const durationMs = new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
  //       const durationMinutes = Math.round(durationMs / 60000 * 10) / 10;
  //       statsEmbed.addFields({ 
  //         name: 'Total Duration', 
  //         value: `${durationMinutes} minutes`, 
  //         inline: true 
  //       });
  //     }
  //     
  //     // Top 10 users by time spent
  //     if (userTimeData.length > 0) {
  //       const topUsers = userTimeData.slice(0, 10).map(u => `${u.username}: ${u.timeMinutes} min`).join('\n');
  //       statsEmbed.addFields({ name: 'Top Users by Time Spent', value: topUsers || 'No data' });
  //     }
  //     
  //     statsEmbed.setTimestamp();
  //     
  //     // Send stats to the specified channel
  //     await channel.send({ embeds: [statsEmbed] });
  //     
  //     // Generate a text file with all user data
  //     let userDataText = "Username,Roles,Time Spent (minutes)\n";
  //     
  //     // Process each user
  //     for (const user of users) {
  //       // Get roles for this user
  //       const roles = dbService.getUserRoles(user.id);
  //       const roleNames = roles.map(r => r.roleName).join('; ');
  //       const timeMinutes = Math.round(user.totalTimeMs / 60000 * 10) / 10;
  //       
  //       userDataText += `${user.username},${roleNames},${timeMinutes}\n`;
  //     }
  //     
  //     // Send the user data as a file
  //     await channel.send({
  //       content: "Detailed user participation data:",
  //       files: [{
  //         attachment: Buffer.from(userDataText),
  //         name: `stage_users_${sessionId}.csv`
  //       }]
  //     });
  //     
  //     // Generate timeline data for graph
  //     const timelinePoints = dbService.getTimelinePoints(sessionId);
  //     
  //     if (timelinePoints.length > 0) {
  //       let timelineData = "Time,UserCount\n";
  //       const startTime = new Date(session.startTime).getTime();
  //       
  //       timelinePoints.forEach(point => {
  //         const minutesSinceStart = Math.round((new Date(point.timestamp).getTime() - startTime) / 60000 * 10) / 10;
  //         timelineData += `${minutesSinceStart},${point.userCount}\n`;
  //       });
  //       
  //       await channel.send({
  //         content: "Timeline data for graphing user participation:",
  //         files: [{
  //           attachment: Buffer.from(timelineData),
  //           name: `stage_timeline_${sessionId}.csv`
  //         }]
  //       });
  //     }
  //     
  //     await interaction.editReply(`Statistics for session ${sessionId} have been sent to the specified channel.`);
  //   }
  // },
  // {
  //   name: "reset-stage-tracking",
  //   description: "End current stage tracking session and start a new one",
  //   defaultMemberPermissions: PermissionFlagsBits.Administrator,
  //   run: async ({ interaction }) => {
  //     // End current session if active
  //     if (activeSessionId) {
  //       dbService.endStageSession(activeSessionId, new Date());
  //       activeSessionId = null;
  //     }
  //     
  //     await interaction.reply({
  //       content: "Stage tracking session has been ended. A new session will start when users join the stage.",
  //       flags: [MessageFlags.Ephemeral],
  //     });
  //   }
  // },
  // {
  //   name: "list-sessions",
  //   description: "List all stage tracking sessions",
  //   run: async ({ interaction }) => {
  //     const sessions = dbService.db
  //       .select()
  //       .from(dbService.db.schema.stageSessions)
  //       .where(dbService.eq(dbService.db.schema.stageSessions.stageId, STAGE_ID))
  //       .orderBy(dbService.db.schema.stageSessions.startTime, "desc")
  //       .all();
  //     
  //     if (sessions.length === 0) {
  //       await interaction.reply({
  //         content: "No stage sessions found.",
  //         flags: [MessageFlags.Ephemeral],
  //       });
  //       return;
  //     }
  //     
  //     const sessionList = sessions.map((session, index) => {
  //       const startTime = new Date(session.startTime).toLocaleString();
  //       const endTime = session.endTime ? new Date(session.endTime).toLocaleString() : "Active";
  //       return `${index + 1}. ID: \`${session.id}\` - Start: ${startTime} - End: ${endTime} - Users: ${session.uniqueUserCount}`;
  //     }).join('\n');
  //     
  //     await interaction.reply({
  //       content: `**Stage Sessions**\n${sessionList}`,
  //       flags: [MessageFlags.Ephemeral],
  //     });
  //   }
  // }
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

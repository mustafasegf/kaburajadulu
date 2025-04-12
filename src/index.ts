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

// Track specific stage by ID
const STAGE_ID = "1339442476863197246";

// Cache for active session
let activeSessionId: string | null = null;

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

      // Save server configuration to database
      dbService.createServer({
        id: interaction.guildId!,
        channelId: channel.id,
        categoryId: category.id
      });

      await interaction.reply({
        content: "Configured!",
        flags: [MessageFlags.Ephemeral],
      });
    },
  },
  {
    name: "stage-stats",
    description: "Get statistics about the tracked stage",
    options: [
      {
        name: "channel",
        description: "The channel to send stats to",
        type: ApplicationCommandOptionType.Channel,
        required: true
      },
      {
        name: "session",
        description: "Session ID (leave empty for current/latest session)",
        type: ApplicationCommandOptionType.String,
        required: false
      }
    ],
    run: async ({ interaction }) => {
      const channel = interaction.options.getChannel("channel") as TextChannel;
      const sessionId = interaction.options.getString("session") || activeSessionId;
      
      if (channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: "Please provide a text channel",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      
      await interaction.deferReply({ ephemeral: true });
      
      if (!sessionId) {
        await interaction.editReply("No active stage session found.");
        return;
      }
      
      // Get session data
      const session = dbService.db
        .select()
        .from(dbService.db.schema.stageSessions)
        .where(dbService.eq(dbService.db.schema.stageSessions.id, sessionId))
        .get();
      
      if (!session) {
        await interaction.editReply(`No session found with ID: ${sessionId}`);
        return;
      }
      
      // Get user data
      const users = dbService.getUsersForSession(sessionId);
      
      if (users.length === 0) {
        await interaction.editReply("No user data available for this session.");
        return;
      }
      
      // Calculate average time spent (in minutes)
      const totalTimeSpent = users.reduce((sum, user) => sum + user.totalTimeMs, 0);
      const avgTimeSpentMinutes = users.length > 0 
        ? Math.round((totalTimeSpent / users.length) / 60000 * 10) / 10 
        : 0;
      
      // Sort users by time spent
      const userTimeData = users.map(user => ({
        id: user.id,
        userId: user.userId,
        username: user.username,
        timeMinutes: Math.round(user.totalTimeMs / 60000 * 10) / 10
      })).sort((a, b) => b.timeMinutes - a.timeMinutes);
      
      // Create stats embed
      const statsEmbed = new EmbedBuilder()
        .setTitle("Stage Activity Statistics")
        .setDescription(`Stats for Stage ID: ${STAGE_ID}`)
        .setColor(0x0099FF)
        .addFields(
          { name: 'Total Unique Users', value: session.uniqueUserCount.toString(), inline: true },
          { name: 'Average Time Spent', value: `${avgTimeSpentMinutes} minutes`, inline: true },
          { name: 'Session Status', value: session.isActive ? 'Active' : 'Ended', inline: true },
          { name: 'Start Time', value: new Date(session.startTime).toLocaleString(), inline: true }
        );
        
      if (session.endTime) {
        statsEmbed.addFields({ 
          name: 'End Time', 
          value: new Date(session.endTime).toLocaleString(), 
          inline: true 
        });
        
        // Calculate total duration if ended
        const durationMs = new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
        const durationMinutes = Math.round(durationMs / 60000 * 10) / 10;
        statsEmbed.addFields({ 
          name: 'Total Duration', 
          value: `${durationMinutes} minutes`, 
          inline: true 
        });
      }
      
      // Top 10 users by time spent
      if (userTimeData.length > 0) {
        const topUsers = userTimeData.slice(0, 10).map(u => `${u.username}: ${u.timeMinutes} min`).join('\n');
        statsEmbed.addFields({ name: 'Top Users by Time Spent', value: topUsers || 'No data' });
      }
      
      statsEmbed.setTimestamp();
      
      // Send stats to the specified channel
      await channel.send({ embeds: [statsEmbed] });
      
      // Generate a text file with all user data
      let userDataText = "Username,Roles,Time Spent (minutes)\n";
      
      // Process each user
      for (const user of users) {
        // Get roles for this user
        const roles = dbService.getUserRoles(user.id);
        const roleNames = roles.map(r => r.roleName).join('; ');
        const timeMinutes = Math.round(user.totalTimeMs / 60000 * 10) / 10;
        
        userDataText += `${user.username},${roleNames},${timeMinutes}\n`;
      }
      
      // Send the user data as a file
      await channel.send({
        content: "Detailed user participation data:",
        files: [{
          attachment: Buffer.from(userDataText),
          name: `stage_users_${sessionId}.csv`
        }]
      });
      
      // Generate timeline data for graph
      const timelinePoints = dbService.getTimelinePoints(sessionId);
      
      if (timelinePoints.length > 0) {
        let timelineData = "Time,UserCount\n";
        const startTime = new Date(session.startTime).getTime();
        
        timelinePoints.forEach(point => {
          const minutesSinceStart = Math.round((new Date(point.timestamp).getTime() - startTime) / 60000 * 10) / 10;
          timelineData += `${minutesSinceStart},${point.userCount}\n`;
        });
        
        await channel.send({
          content: "Timeline data for graphing user participation:",
          files: [{
            attachment: Buffer.from(timelineData),
            name: `stage_timeline_${sessionId}.csv`
          }]
        });
      }
      
      await interaction.editReply(`Statistics for session ${sessionId} have been sent to the specified channel.`);
    }
  },
  {
    name: "reset-stage-tracking",
    description: "End current stage tracking session and start a new one",
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
    run: async ({ interaction }) => {
      // End current session if active
      if (activeSessionId) {
        dbService.endStageSession(activeSessionId, new Date());
        activeSessionId = null;
      }
      
      await interaction.reply({
        content: "Stage tracking session has been ended. A new session will start when users join the stage.",
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
  {
    name: "list-sessions",
    description: "List all stage tracking sessions",
    run: async ({ interaction }) => {
      const sessions = dbService.db
        .select()
        .from(dbService.db.schema.stageSessions)
        .where(dbService.eq(dbService.db.schema.stageSessions.stageId, STAGE_ID))
        .orderBy(dbService.db.schema.stageSessions.startTime, "desc")
        .all();
      
      if (sessions.length === 0) {
        await interaction.reply({
          content: "No stage sessions found.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      
      const sessionList = sessions.map((session, index) => {
        const startTime = new Date(session.startTime).toLocaleString();
        const endTime = session.endTime ? new Date(session.endTime).toLocaleString() : "Active";
        return `${index + 1}. ID: \`${session.id}\` - Start: ${startTime} - End: ${endTime} - Users: ${session.uniqueUserCount}`;
      }).join('\n');
      
      await interaction.reply({
        content: `**Stage Sessions**\n${sessionList}`,
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
];

// Helper function to handle user joining stage
async function handleUserJoin(memberId: string, username: string, roles: string[]) {
  const now = new Date();
  
  // Check if we have an active session
  if (!activeSessionId) {
    // Create new session
    const session = dbService.createStageSession({
      stageId: STAGE_ID,
      startTime: now,
      isActive: true
    });
    
    activeSessionId = session.id;
    console.log(`Started new stage session: ${activeSessionId}`);
  }
  
  // Get or create user record
  const existingUser = dbService.getStageUser(activeSessionId, memberId);
  
  if (existingUser) {
    // User rejoining - update join time
    dbService.upsertStageUser({
      id: existingUser.id,
      userId: memberId,
      username,
      sessionId: activeSessionId,
      joinTime: now,
      leaveTime: null,
      totalTimeMs: existingUser.totalTimeMs
    });
  } else {
    // New user
    const user = dbService.upsertStageUser({
      userId: memberId,
      username,
      sessionId: activeSessionId,
      joinTime: now,
      totalTimeMs: 0
    });
    
    // Save user roles
    for (const roleName of roles) {
      dbService.addUserRole(user.id, roleName);
    }
    
    // Update unique user count
    const users = dbService.getUsersForSession(activeSessionId);
    dbService.updateSessionUniqueUserCount(activeSessionId, users.length);
  }
  
  // Add timeline point
  const activeUsers = dbService.db
    .select()
    .from(dbService.db.schema.stageUsers)
    .where(dbService.and(
      dbService.eq(dbService.db.schema.stageUsers.sessionId, activeSessionId),
      dbService.isNull(dbService.db.schema.stageUsers.leaveTime)
    ))
    .all();
    
  dbService.addTimelinePoint(activeSessionId, now, activeUsers.length);
}

// Helper function to handle user leaving stage
async function handleUserLeave(memberId: string) {
  if (!activeSessionId) return;
  
  const now = new Date();
  
  // Get user record
  const user = dbService.getStageUser(activeSessionId, memberId);
  
  if (user && !user.leaveTime) {
    // Calculate time spent in this session
    const joinTime = new Date(user.joinTime).getTime();
    const leaveTime = now.getTime();
    const sessionTimeMs = leaveTime - joinTime;
    const totalTimeMs = user.totalTimeMs + sessionTimeMs;
    
    // Update user record
    dbService.markUserLeave(activeSessionId, memberId, now, totalTimeMs);
    
    // Add timeline point
    const activeUsers = dbService.db
      .select()
      .from(dbService.db.schema.stageUsers)
      .where(dbService.and(
        dbService.eq(dbService.db.schema.stageUsers.sessionId, activeSessionId),
        dbService.isNull(dbService.db.schema.stageUsers.leaveTime)
      ))
      .all();
    
    dbService.addTimelinePoint(activeSessionId, now, activeUsers.length - 1);
    
    // If everyone left, end the session
    if (activeUsers.length <= 1) {
      dbService.endStageSession(activeSessionId, now);
      console.log(`Ended stage session: ${activeSessionId}`);
      activeSessionId = null;
    }
  }
}

async function main() {
  client.on("ready", async (client) => {
    await client.application.commands.set(commands);

    const { username, tag } = client.user;
    console.log(`Bot has been logged in as ${username} (${tag})!`);
    console.log(`Tracking stage with ID: ${STAGE_ID}`);
    
    // Check if there's an active session
    const existingSession = dbService.getActiveStageSession(STAGE_ID);
    if (existingSession) {
      activeSessionId = existingSession.id;
      console.log(`Resumed active stage session: ${activeSessionId}`);
    }
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
    
    // Track stage activity
    const stageChannelId = STAGE_ID;
    
    // Check if user is joining the target stage
    if (newState.channelId === stageChannelId && oldState.channelId !== stageChannelId) {
      console.log(`${newState.member!.user.username} joined the tracked stage`);
      
      // Get user roles
      const userRoles = newState.member!.roles.cache.map(role => role.name);
      
      // Handle user join
      await handleUserJoin(
        newState.member!.id,
        newState.member!.user.username,
        userRoles
      );
    } 
    // Check if user is leaving the target stage
    else if (oldState.channelId === stageChannelId && newState.channelId !== stageChannelId) {
      console.log(`${oldState.member!.user.username} left the tracked stage`);
      
      // Handle user leave
      await handleUserLeave(oldState.member!.id);
    }
    
    // Get server configuration from database
    const server = dbService.getServer(newState.guild.id);
    
    if (server && newState.channelId === server.channelId) {
      // Create a new voice channel
      const channel = await newState.guild.channels.create({
        name: `${newState.member!.user.username}'s Channel`,
        type: ChannelType.GuildVoice,
        parent: server.categoryId,
        permissionOverwrites: [
          {
            id: newState.member!.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
      });

      // Store the channel ID
      const ids: Record<string, VoiceChannel> = {};
      ids[newState.member!.id] = channel;

      // Move the member to the new vc
      newState.member?.voice.setChannel(channel);
    }

    // Handle cleanup of empty channels
    if (oldState.channel && oldState.channel.members.size === 0) {
      const ids: Record<string, VoiceChannel> = {}; // This would be better stored in the database
      if (ids[oldState.member!.id]?.id === oldState.channel.id) {
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

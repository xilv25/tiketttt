require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  ChannelType
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// Load config.json
let config = {};
try {
  config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
} catch (e) {
  console.log("config.json kosong / error, pakai {}");
  config = {};
}

// fungsi simpan config
function saveConfig() {
  fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
}

// Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// =============== REGISTER SLASH COMMAND /setup ===============
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Setup panel tiket untuk server ini")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
      .addChannelOption(opt =>
        opt
          .setName("panel_channel")
          .setDescription("Channel tempat panel tiket dikirim")
          .setRequired(true)
      )
      .addChannelOption(opt =>
        opt
          .setName("ticket_category")
          .setDescription("Kategori untuk channel tiket")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addRoleOption(opt =>
        opt
          .setName("support_role")
          .setDescription("Role yang bisa melihat & handle tiket")
          .setRequired(true)
      )
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands registered!");
  } catch (error) {
    console.error(error);
  }
}

// =============== READY EVENT ===============
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

// =============== HANDLE INTERAKSI ===============
client.on("interactionCreate", async (interaction) => {
  // Slash Command
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "setup") {
      await handleSetup(interaction);
    }
  }

  // Button
  if (interaction.isButton()) {
    if (interaction.customId === "open_ticket") {
      await handleOpenTicket(interaction);
    } else if (interaction.customId.startsWith("close_ticket_")) {
      await handleCloseTicket(interaction);
    } else if (interaction.customId.startsWith("delete_ticket_")) {
      await handleDeleteTicket(interaction);
    }
  }
});

// =============== FUNGSI /setup ===============
async function handleSetup(interaction) {
  const guildId = interaction.guild.id;

  const panelChannel = interaction.options.getChannel("panel_channel", true);
  const ticketCategory = interaction.options.getChannel("ticket_category", true);
  const supportRole = interaction.options.getRole("support_role", true);

  // Simpan konfigurasi
  if (!config[guildId]) config[guildId] = {};
  config[guildId].panelChannelId = panelChannel.id;
  config[guildId].ticketCategoryId = ticketCategory.id;
  config[guildId].supportRoleId = supportRole.id;
  saveConfig();

  // Bikin panel tiket
  const embed = new EmbedBuilder()
    .setTitle("🎫 Support Ticket")
    .setDescription(
      "Klik tombol di bawah untuk membuat tiket baru.\n" +
      "Staff dengan role <@&" + supportRole.id + "> akan membantu kamu."
    )
    .setColor(0x00ff9d);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_ticket")
      .setLabel("Buka Tiket")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🎫")
  );

  await panelChannel.send({ embeds: [embed], components: [row] });

  await interaction.reply({
    content: `✅ Setup selesai!\nPanel dikirim ke ${panelChannel}.\nKategori tiket: ${ticketCategory}\nRole support: <@&${supportRole.id}>`,
    ephemeral: true
  });
}

// =============== FUNGSI BUKA TIKET ===============
async function handleOpenTicket(interaction) {
  const guild = interaction.guild;
  const guildId = guild.id;
  const user = interaction.user;

  const guildConfig = config[guildId];
  if (!guildConfig) {
    return interaction.reply({
      content: "❌ Server ini belum di-setup. Jalankan `/setup` dulu.",
      ephemeral: true
    });
  }

  const categoryId = guildConfig.ticketCategoryId;
  const supportRoleId = guildConfig.supportRoleId;

  // Cek kalau user sudah punya tiket yang masih buka (opsional)
  const existing = guild.channels.cache.find(
    ch =>
      ch.name === `ticket-${user.id}` &&
      ch.parentId === categoryId
  );
  if (existing) {
    return interaction.reply({
      content: `❌ Kamu sudah punya tiket: ${existing}`,
      ephemeral: true
    });
  }

  // Bikin channel tiket
  const channel = await guild.channels.create({
    name: `ticket-${user.id}`,
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      },
      {
        id: supportRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }
    ]
  });

  const embed = new EmbedBuilder()
    .setTitle("🎫 Tiket Support")
    .setDescription(
      `Halo ${user}, jelaskan kendala / kebutuhan kamu di sini.\n` +
      `Staff dengan role <@&${supportRoleId}> akan segera membantu.`
    )
    .setColor(0x00ff9d)
    .setFooter({ text: `User ID: ${user.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket_${user.id}`)
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${user.id}> <@&${supportRoleId}>`,
    embeds: [embed],
    components: [row]
  });

  await interaction.reply({
    content: `✅ Tiket kamu sudah dibuat: ${channel}`,
    ephemeral: true
  });
}

// =============== FUNGSI CLOSE TIKET ===============
async function handleCloseTicket(interaction) {
  const channel = interaction.channel;
  const userId = interaction.customId.split("_")[2];

  if (!channel.name.startsWith("ticket-")) {
    return interaction.reply({
      content: "❌ Tombol ini bukan di channel tiket.",
      ephemeral: true
    });
  }

  // setelah close, hanya staff yang bisa lihat, user di-remove
  const guildConfig = config[interaction.guild.id];
  if (!guildConfig) {
    return interaction.reply({
      content: "❌ Konfigurasi server tidak ditemukan.",
      ephemeral: true
    });
  }

  const supportRoleId = guildConfig.supportRoleId;

  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: false,
    SendMessages: false
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`delete_ticket_${userId}`)
      .setLabel("Delete Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({
    content: "🔒 Tiket telah di-close. Tekan tombol di bawah untuk menghapus channel.",
    components: [row]
  });
}

// =============== FUNGSI DELETE TIKET ===============
async function handleDeleteTicket(interaction) {
  const channel = interaction.channel;

  if (!channel.name.startsWith("ticket-")) {
    return interaction.reply({
      content: "❌ Tombol ini bukan di channel tiket.",
      ephemeral: true
    });
  }

  await interaction.reply({ content: "🗑 Menghapus channel dalam 3 detik..." });
  setTimeout(() => {
    channel.delete().catch(() => {});
  }, 3000);
}

// Login bot
client.login(TOKEN);

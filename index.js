require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require("discord.js");

// ===============================
// CONFIG
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID || null;   // staff ticket (purchase)
const HELPER_ROLE_ID = process.env.HELPER_ROLE_ID || null;     // LimeHub Team (support)
const PREMIUM_ROLE_ID = process.env.PREMIUM_ROLE_ID || null;   // role premium user
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;
const PREMIUM_PANEL_CHANNEL_ID = process.env.PREMIUM_PANEL_CHANNEL_ID || null;
const TUTORIAL_IMAGE_URL = process.env.TUTORIAL_IMAGE_URL || null;

// mulai dari ribuan untuk purchase
const TICKET_START_NUMBER = Number(process.env.TICKET_START_NUMBER) || 8828;
let ticketCounter = TICKET_START_NUMBER;

// mulai dari 0 untuk support, jadi tiket pertama #1
const SUPPORT_TICKET_START_NUMBER =
  Number(process.env.SUPPORT_TICKET_START_NUMBER) || 0;
let supportTicketCounter = SUPPORT_TICKET_START_NUMBER;

const THEME_COLOR = 0x00cf91;

// ticket yang sudah di-claim (supaya nggak ikut antrian)
const claimedTickets = new Set();

// FAQ storage (in-memory)
let faqIdCounter = 0;
const faqItems = []; // { id: '1', question: '...', answer: '...' }

// countdown FAQ per channel (biar bisa di-reset)
const faqCountdowns = new Map(); // channelId -> intervalId

// helper format waktu 00:MM:SS
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `00:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ===============================
// SLASH COMMANDS
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup panel tiket di channel ini.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("faq")
    .setDescription("Kelola FAQ untuk tiket support.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Tambah / update satu item FAQ.")
        .addStringOption((opt) =>
          opt
            .setName("question")
            .setDescription("Pertanyaan yang sering ditanyakan.")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("answer")
            .setDescription("Jawaban untuk pertanyaan tersebut.")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Lihat semua pertanyaan FAQ yang tersimpan.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Hapus salah satu pertanyaan FAQ.")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
].map((cmd) => cmd.toJSON());

// ===============================
// REGISTER SLASH COMMANDS
// ===============================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  console.log("🔁 Registering slash commands...");
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error("❌ Failed to register commands:");
    console.error(err);
  }
}

// ===============================
// READY
// ===============================
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  await registerCommands();
});

// ===============================
// INTERACTIONS (SLASH + BUTTON + SELECT)
// ===============================
client.on(Events.InteractionCreate, async (interaction) => {
  // /SETUP dan /FAQ
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "setup") {
      const panelEmbed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle("🎟️ LimeHub Ticket Panel")
        .setDescription(
          [
            "Klik tombol di bawah untuk membuat tiket baru.",
            "",
            "Gunakan tiket hanya untuk keperluan **transaksi** dan **support** terkait layanan LimeHub.",
          ].join("\n")
        )
        .setFooter({
          text: "created by @unstoppable_neid • LimeHub Ticket System",
        })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("create_ticket")
          .setLabel("Create Ticket")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({
        embeds: [panelEmbed],
        components: [row],
      });

      await interaction.reply({
        content: "✅ Panel tiket sudah dibuat.",
        ephemeral: true,
      });
    }

    if (interaction.commandName === "faq") {
      const sub = interaction.options.getSubcommand();

      if (sub === "set") {
        const question = interaction.options.getString("question", true);
        const answer = interaction.options.getString("answer", true);

        faqIdCounter += 1;
        const id = String(faqIdCounter);
        faqItems.push({ id, question, answer });

        await interaction.reply({
          content: `✅ FAQ item #${id} ditambahkan:\n**Q:** ${question}`,
          ephemeral: true,
        });
      }

      if (sub === "list") {
        if (!faqItems.length) {
          return interaction.reply({
            content: "📚 Belum ada FAQ yang tersimpan.",
            ephemeral: true,
          });
        }

        const desc = faqItems
          .map((item) => `\`#${item.id}\` **${item.question}**`)
          .join("\n");

        const listEmbed = new EmbedBuilder()
          .setColor(THEME_COLOR)
          .setTitle("📚 FAQ List")
          .setDescription(desc)
          .setTimestamp();

        await interaction.reply({
          embeds: [listEmbed],
          ephemeral: true,
        });
      }

      if (sub === "remove") {
        if (!faqItems.length) {
          return interaction.reply({
            content: "❌ Tidak ada FAQ yang bisa dihapus.",
            ephemeral: true,
          });
        }

        const options = faqItems.map((item) => ({
          label: item.question.slice(0, 100),
          value: item.id,
          description: `ID #${item.id}`,
        }));

        const menu = new StringSelectMenuBuilder()
          .setCustomId("faq_remove_select")
          .setPlaceholder("Pilih pertanyaan FAQ yang ingin dihapus")
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(menu);

        await interaction.reply({
          content: "Pilih pertanyaan yang ingin dihapus:",
          components: [row],
          ephemeral: true,
        });
      }
    }
    return;
  }

  // BUTTONS
  if (interaction.isButton()) {
    // ===============================
    // CREATE TICKET
    // ===============================
    if (interaction.customId === "create_ticket") {
      const guild = interaction.guild;
      const member = interaction.member;

      // cek apakah user sudah punya ticket (berdasarkan topic = user.id)
      const existing = guild.channels.cache.find(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          (ch.name.startsWith("ticket-") || ch.name.startsWith("support-")) &&
          ch.topic === member.id
      );
      if (existing) {
        return interaction.reply({
          content: `❌ Kamu sudah punya tiket: ${existing}`,
          ephemeral: true,
        });
      }

      // cek premium atau bukan
      const hasPremium =
        PREMIUM_ROLE_ID && member.roles.cache.has(PREMIUM_ROLE_ID);

      let handlerRoleId; // role yang akan di-mention & punya akses
      let channelSuffix;
      let isSupportTicket;
      let ticketNumber;

      if (hasPremium) {
        // ===== SUPPORT TICKET =====
        isSupportTicket = true;
        channelSuffix = "❓";
        handlerRoleId = HELPER_ROLE_ID || null; // LimeHub Team saja

        supportTicketCounter += 1;
        ticketNumber = supportTicketCounter;
      } else {
        // ===== PURCHASE TICKET =====
        isSupportTicket = false;
        channelSuffix = "🛒";
        handlerRoleId = SUPPORT_ROLE_ID || null; // Staff ticket

        ticketCounter += 1;
        ticketNumber = ticketCounter;
      }

      const overwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: member.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ];

      if (handlerRoleId) {
        overwrites.push({
          id: handlerRoleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        });
      }

      const channelName = isSupportTicket
        ? `support-${ticketNumber}-❓`
        : `ticket-${ticketNumber}-🛒`;

      // simpan owner tiket di topic channel
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID || undefined,
        permissionOverwrites: overwrites,
        topic: member.id,
      });

      const handlerMention = handlerRoleId
        ? `<@&${handlerRoleId}>`
        : "Staff";

      const ticketButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("claim_ticket")
          .setLabel("Claim Ticket")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Close Ticket")
          .setStyle(ButtonStyle.Danger)
      );

      if (!isSupportTicket) {
        // ===== PURCHASE TICKET EMBED (Qris/PayPal) =====
        const ticketEmbed = new EmbedBuilder()
          .setColor(THEME_COLOR)
          .setTitle(`🎟️ Ticket #${ticketNumber} — ${member}`)
          .setDescription(
            [
              `Halo ${member}, terima kasih telah membuat tiket di **LimeHub**.`,
              "",
              "💵 **Harga Script:** Rp 40.000",
              "",
              "Silakan lakukan pembayaran ke salah satu metode berikut:",
              "",
              "🔗 **Qris :** [Click here](https://shinzux.vercel.app/image_4164bbec-5215-4e0c-98ca-d4c198a10c9e.png)",
              "🔗 **Paypal :** [Click here](https://www.paypal.me/RizkiJatiPrasetyo)",
              "",
              "⚠️ Setelah melakukan pembayaran, **WAJIB** upload bukti transfer (screenshot).",
              `${handlerMention} akan memproses tiket kamu setelah bukti diterima.`,
            ].join("\n")
          )
          .setFooter({
            text: `created by @unstoppable_neid • LimeHub Purchase`,
            iconURL: interaction.client.user.displayAvatarURL(),
          })
          .setTimestamp();

        await channel.send({
          embeds: [ticketEmbed],
          components: [ticketButtons],
        });
      } else {
        // ===== SUPPORT TICKET EMBED + FAQ =====
        const supportEmbed = new EmbedBuilder()
          .setColor(THEME_COLOR)
          .setTitle(`❓ Support Ticket #${ticketNumber} — ${member}`)
          .setDescription(
            [
              `Halo ${member}, terima kasih telah membuka tiket support **LimeHub**.`,
              "",
              "Sebelum LimeHub Team menjawab secara langsung, silakan pilih salah satu pertanyaan di bawah.",
              "Banyak masalah umum sudah dijawab di FAQ.",
            ].join("\n")
          )
          .setFooter({
            text: `created by @unstoppable_neid • LimeHub Support`,
            iconURL: interaction.client.user.displayAvatarURL(),
          })
          .setTimestamp();

        await channel.send({
          embeds: [supportEmbed],
          components: [ticketButtons],
        });

        // FAQ embed + select
        const faqEmbed = new EmbedBuilder()
          .setColor(THEME_COLOR)
          .setTitle("📚 FAQ Support")
          .setDescription(
            faqItems.length
              ? "Pilih pertanyaan yang paling sesuai dengan kendalamu:"
              : "Belum ada FAQ yang diset. Pilih **Other options** untuk memanggil LimeHub Team."
          );

        const options = faqItems.map((item) => ({
          label: item.question.slice(0, 100),
          value: item.id,
        }));

        options.push({
          label: "Other options (hubungi LimeHub Team)",
          value: "other",
        });

        const faqMenu = new StringSelectMenuBuilder()
          .setCustomId("support_faq_select")
          .setPlaceholder("Pilih pertanyaan FAQ di sini")
          .addOptions(options);

        const faqRow = new ActionRowBuilder().addComponents(faqMenu);

        await channel.send({
          embeds: [faqEmbed],
          components: [faqRow],
        });
      }

      // EPHEMERAL CONFIRM + GO TO TICKET
      const confirmEmbed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle("✅ Ticket berhasil dibuat")
        .setDescription(
          [
            `Tiket kamu berhasil dibuat: ${channel}`,
            "",
            "Klik tombol di bawah untuk menuju ticket kamu.",
          ].join("\n")
        )
        .setFooter({
          text: "created by @unstoppable_neid • LimeHub Ticket System",
        })
        .setTimestamp();

      const jumpRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Go to ticket")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guild.id}/${channel.id}`)
      );

      await interaction.reply({
        embeds: [confirmEmbed],
        components: [jumpRow],
        ephemeral: true,
      });
    }

    // ===============================
    // CLAIM TICKET
    // ===============================
    if (interaction.customId === "claim_ticket") {
      const channel = interaction.channel;
      const guild = interaction.guild;
      const memberRoles = interaction.member.roles.cache;

      const isPurchase = channel.name.startsWith("ticket-");
      const isSupport = channel.name.startsWith("support-");

      // izin claim:
      //  - purchase: hanya SUPPORT_ROLE_ID
      //  - support:  hanya HELPER_ROLE_ID
      let canClaim = true;
      if (isPurchase) {
        canClaim = SUPPORT_ROLE_ID && memberRoles.has(SUPPORT_ROLE_ID);
      } else if (isSupport) {
        canClaim = HELPER_ROLE_ID && memberRoles.has(HELPER_ROLE_ID);
      }

      if (!canClaim) {
        return interaction.reply({
          content: "❌ Kamu tidak punya izin untuk claim ticket ini.",
          ephemeral: true,
        });
      }

      claimedTickets.add(channel.id);

      // ambil owner tiket dari topic
      let ticketUserMention = "customer";
      if (channel.topic) {
        try {
          const m = await guild.members.fetch(channel.topic);
          ticketUserMention = `${m}`;
        } catch {
          ticketUserMention = "customer";
        }
      }

      const title =
        isSupport ? "✅ Pertanyaan telah diselesaikan" : "🛠️ Ticket Processing";

      const processingEmbed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle(title)
        .setDescription(
          [
            `Tiket ini telah diselesaikan oleh ${interaction.member}.`,
            "",
            `Halo ${ticketUserMention}, pertanyaan kamu sudah terjawab semua, mohon kerjasamanya untuk review LimeHub sesuai dengan pengalaman kamu!`,
          ].join("\n")
        )
        .setTimestamp();

      await channel.send({ embeds: [processingEmbed] });

      await interaction.reply({
        content: "✅ Kamu telah meng-claim ticket ini.",
        ephemeral: true,
      });

      // ----- kalau SUPPORT TICKET: cukup processing saja -----
      if (isSupport) return;

      // ----- kalau PURCHASE TICKET: Ticket Done + countdown + auto close -----
      setTimeout(async () => {
        const premiumMention = PREMIUM_PANEL_CHANNEL_ID
          ? `<#${PREMIUM_PANEL_CHANNEL_ID}>`
          : "`#premium-panel`";

        const makeDoneEmbed = (seconds) =>
          new EmbedBuilder()
            .setColor(THEME_COLOR)
            .setTitle("✅ Ticket Done")
            .setDescription(
              [
                `Halo ${ticketUserMention}, tiket kamu sudah selesai.`,
                "",
                `Silakan lanjut ke channel ${premiumMention}.`,
                "",
                "Klik **Get Script** untuk mengambil script kamu!",
                "",
                `Ticket akan otomatis ditutup dalam **${formatTime(seconds)}**.`,
              ].join("\n")
            )
            .setTimestamp();

        let remaining = 60; // detik

        const msg = await channel
          .send({ embeds: [makeDoneEmbed(remaining)] })
          .catch(() => null);
        if (!msg) return;

        const interval = setInterval(async () => {
          remaining--;

          if (remaining >= 0) {
            msg.edit({ embeds: [makeDoneEmbed(remaining)] }).catch(() => {});
          }

          if (remaining === 0) {
            clearInterval(interval);

            // setelah 1 detik, kirim "Ticket Closed" lalu delete channel 1 detik kemudian
            setTimeout(async () => {
              const closedEmbed = new EmbedBuilder()
                .setColor(THEME_COLOR)
                .setTitle("🔒 Ticket Closed")
                .setDescription(
                  "Ticket ini telah ditutup. Terima kasih telah menggunakan layanan LimeHub."
                )
                .setTimestamp();

              await channel.send({ embeds: [closedEmbed] }).catch(() => {});

              setTimeout(() => {
                channel.delete().catch(() => {});
              }, 1000);
            }, 1000);
          }
        }, 1000);
      }, 5000);
    }

    // ===============================
    // CLOSE TICKET (manual, countdown 3..2..1)
    // ===============================
    if (interaction.customId === "close_ticket") {
      const channel = interaction.channel;
      const memberRoles = interaction.member.roles.cache;

      const isPurchase = channel.name.startsWith("ticket-");
      const isSupport = channel.name.startsWith("support-");

      // izin close:
      //  - purchase: SUPPORT_ROLE_ID
      //  - support:  HELPER_ROLE_ID
      let canClose = true;
      if (isPurchase) {
        canClose = SUPPORT_ROLE_ID && memberRoles.has(SUPPORT_ROLE_ID);
      } else if (isSupport) {
        canClose = HELPER_ROLE_ID && memberRoles.has(HELPER_ROLE_ID);
      }

      if (!canClose) {
        return interaction.reply({
          content: "❌ Kamu tidak punya izin untuk menutup ticket ini.",
          ephemeral: true,
        });
      }

      claimedTickets.delete(channel.id);

      const buildEmbed = (sec) =>
        new EmbedBuilder()
          .setColor(THEME_COLOR)
          .setTitle("🔒 Closing Ticket")
          .setDescription(`Ticket akan ditutup dalam **${sec} detik**.`)
          .setTimestamp();

      const msg = await interaction.reply({
        embeds: [buildEmbed(3)],
        fetchReply: true,
      });

      let remaining = 3;
      const interval = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          msg.edit({ embeds: [buildEmbed(remaining)] }).catch(() => {});
        } else {
          clearInterval(interval);
          channel.delete().catch(() => {});
        }
      }, 1000);
    }

    return;
  }

  // ===============================
  // SELECT MENU (FAQ SUPPORT & FAQ REMOVE)
// ===============================
  if (interaction.isStringSelectMenu()) {
    // ---- SELECT UNTUK HAPUS FAQ ----
    if (interaction.customId === "faq_remove_select") {
      // hanya admin
      if (
        !interaction.member.permissions.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content: "❌ Kamu tidak punya izin untuk menghapus FAQ.",
          ephemeral: true,
        });
      }

      const id = interaction.values[0];
      const index = faqItems.findIndex((f) => f.id === id);
      if (index === -1) {
        return interaction.reply({
          content: "❌ FAQ tidak ditemukan (mungkin sudah dihapus).",
          ephemeral: true,
        });
      }

      const [removed] = faqItems.splice(index, 1);

      await interaction.reply({
        content: `✅ FAQ \`#${id}\` dihapus:\n**${removed.question}**`,
        ephemeral: true,
      });

      return;
    }

    // ---- SELECT UNTUK SUPPORT FAQ ----
    if (interaction.customId === "support_faq_select") {
      const value = interaction.values[0];
      const channel = interaction.channel;

      // hanya untuk channel support
      if (!channel.name.startsWith("support-")) {
        return interaction.reply({
          content: "❌ Menu ini hanya untuk tiket support.",
          ephemeral: true,
        });
      }

      if (value === "other") {
        const helperMention = HELPER_ROLE_ID
          ? `<@&${HELPER_ROLE_ID}>`
          : SUPPORT_ROLE_ID
          ? `<@&${SUPPORT_ROLE_ID}>`
          : "Staff";

        await interaction.reply({
          content: `📣 ${helperMention}, ada pertanyaan lain dari ${interaction.member}.`,
          ephemeral: false,
        });
        return;
      }

      const faq = faqItems.find((f) => f.id === value);
      if (!faq) {
        await interaction.reply({
          content: "❌ FAQ tidak ditemukan (mungkin sudah direset).",
          ephemeral: true,
        });
        return;
      }

      const question = faq.question;
      const answer = faq.answer;

      // stop countdown FAQ sebelumnya di channel ini (kalau ada)
      const oldInterval = faqCountdowns.get(channel.id);
      if (oldInterval) {
        clearInterval(oldInterval);
      }

      let remaining = 300; // 5 menit

      const makeFaqEmbed = (seconds) =>
        new EmbedBuilder()
          .setColor(THEME_COLOR)
          .setTitle("💡 FAQ Answer")
          .setDescription(
            [
              `**Q: ${question}**`,
              "",
              `**A: ${answer}**`,
              "",
              `Session FAQ ini akan berakhir dalam **${formatTime(seconds)}**.`,
            ].join("\n")
          )
          .setTimestamp();

      const msg = await interaction.reply({
        embeds: [makeFaqEmbed(remaining)],
        fetchReply: true,
        ephemeral: false,
      });

      const interval = setInterval(() => {
        remaining--;
        if (remaining >= 0) {
          msg.edit({ embeds: [makeFaqEmbed(remaining)] }).catch(() => {});
        }
        if (remaining === 0) {
          clearInterval(interval);
          faqCountdowns.delete(channel.id);
        }
      }, 1000);

      faqCountdowns.set(channel.id, interval);

      return;
    }
  }
});

// ===============================
// MESSAGE LISTENER
//   - .done → embed tutorial BEFORE/AFTER (hanya purchase tickets)
//   - bukti transfer → STATUS ANTRIAN (hanya purchase tickets)
// ===============================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const channel = message.channel;
  if (channel.type !== ChannelType.GuildText) return;

  const guild = message.guild;

  // ---------- .done hanya untuk ticket purchase ----------
  if (channel.name.startsWith("ticket-")) {
    if (message.content.trim().toLowerCase() === ".done") {
      const memberRoles = message.member.roles.cache;

      let canUseDone = true;
      if (SUPPORT_ROLE_ID || HELPER_ROLE_ID) {
        canUseDone =
          (SUPPORT_ROLE_ID && memberRoles.has(SUPPORT_ROLE_ID)) ||
          (HELPER_ROLE_ID && memberRoles.has(HELPER_ROLE_ID));
      }

      if (!canUseDone) {
        return message.reply(
          "❌ Hanya staff/helper yang dapat menggunakan `.done`."
        );
      }

      // tandai sudah selesai supaya tidak masuk antrian
      claimedTickets.add(channel.id);

      const premiumMention = PREMIUM_PANEL_CHANNEL_ID
        ? `<#${PREMIUM_PANEL_CHANNEL_ID}>`
        : "`#premium-panel`";

      const doneEmbed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setAuthor({ name: "Ticket Staff" })
        .setTitle("Done!")
        .setDescription(
          [
            "__Berhasil membeli script 🛒__",
            "",
            `• Langkah selanjutnya adalah melakukan pengambilan script di ${premiumMention}.`,
            '• Klik **"Get Script"** untuk mendapatkan script.',
            "• Kemudian copy script kamu dan lakukan pemotongan untuk membersihkan bagian yang tidak termasuk dalam script.",
            "• Ikuti contoh pada gambar.",
            "• Selesai, kamu telah berhasil mengambil script dengan baik dan benar!",
            "",
            "Apabila mengalami kendala saat execute script, pastikan kamu sudah melakukannya sesuai seperti pada contoh gambar di bawah.",
          ].join("\n")
        )
        .setFooter({ text: "created by @unstoppable_neid" })
        .setTimestamp();

      if (TUTORIAL_IMAGE_URL) {
        doneEmbed.setImage(TUTORIAL_IMAGE_URL); 
      }

      await channel.send({ embeds: [doneEmbed] });
      return; 
    }
  }

  if (!channel.name.startsWith("ticket-")) return;

  const attachments = [...message.attachments.values()];
  const hasImage = attachments.some((att) =>
    att.contentType?.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((ext) =>
      att.url.toLowerCase().endsWith(ext)
    )
  );

  if (!hasImage) return;

  let openTickets = guild.channels.cache.filter(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.name.startsWith("ticket-") &&
      !claimedTickets.has(c.id)
  );

  openTickets = openTickets.sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );
  const arr = [...openTickets.values()];

  const total = arr.length;
  const index = arr.findIndex((c) => c.id === channel.id);
  if (index === -1) return;

  const position = index + 1;

  const queueEmbed = new EmbedBuilder()
    .setColor(THEME_COLOR)
    .setTitle("📊 STATUS ANTRIAN")
    .setDescription(
      `Halo ${message.member}, bukti pembayaran kamu sudah diterima ✅`
    )
    .addFields({
      name: "__POSISI ANTRIAN ANDA__",
      value:
        "```yaml\n" +
        `🚀 POSISI: #${position} dari ${total}\n` +
        "```",
    })
    .addFields({
      name: "✨",
      value: "Tiket kamu akan diproses sebentar lagi!",
    })
    .setFooter({
      text: "made by @unstoppable_neid • LimeHub Ticket System",
    })
    .setTimestamp();

  await channel.send({ embeds: [queueEmbed] });
});

client.login(process.env.TOKEN);

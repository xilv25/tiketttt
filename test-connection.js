const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

console.log("Environment check:");
console.log("TOKEN exists:", !!TOKEN);
console.log("TOKEN length:", TOKEN ? TOKEN.length : 0);
console.log("CLIENT_ID exists:", !!CLIENT_ID);
console.log("CLIENT_ID:", CLIENT_ID);

const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`✅ Bot logged in successfully as ${client.user.tag}`);
  process.exit(0);
});

client.on("error", (error) => {
  console.error("❌ Client error:", error);
  process.exit(1);
});

console.log("Attempting to login...");
client.login(TOKEN).catch(error => {
  console.error("❌ Login failed:", error.message);
  process.exit(1);
});

setTimeout(() => {
  console.log("⏱️ Login timeout after 10 seconds");
  process.exit(1);
}, 10000);

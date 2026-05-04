import { Keyboard } from "@maxhub/max-bot-api";

const ALLOWED_UPDATES = [
  "message_created",
  "message_callback",
  "bot_started",
];

export { ALLOWED_UPDATES };

/**
 * @param {import("@maxhub/max-bot-api").Bot} bot
 */
export function attachHandlers(bot) {
  bot.command("start", async (ctx) => {
    const keyboard = Keyboard.inlineKeyboard([
      [Keyboard.button.callback("Ping", "ping")],
      [Keyboard.button.link("Документация MAX", "https://dev.max.ru/docs")],
    ]);

    await ctx.reply(
      "Привет. Это **тестовый бот**. Напиши /help или нажми кнопку.",
      { format: "markdown", attachments: [keyboard] },
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "**Команды**",
        "/start — приветствие и кнопки",
        "/help — эта справка",
        "/echo текст — повторить текст",
      ].join("\n"),
      { format: "markdown" },
    );
  });

  bot.command(/^echo(?:\s+(.+))?$/u, async (ctx) => {
    const payload = ctx.match?.[1]?.trim() ?? "";
    if (!payload) {
      await ctx.reply("Использование: /echo любой текст", { format: "markdown" });
      return;
    }
    await ctx.reply(payload);
  });

  bot.hears(/^контекст|context$/iu, async (ctx) => {
    const marker = `\`chat_id: ${ctx.chatId}\`\n`;
    const userPart = ctx.user
      ? `user: ${ctx.user.name ?? ""} (${ctx.user.user_id})`
      : "user: неизвестен";
    await ctx.reply(`${marker}${userPart}`, { format: "markdown" });
  });

  bot.action("ping", async (ctx) => {
    await ctx.answerOnCallback({ notification: "pong" });
    await ctx.reply("pong", {
      link: { type: "reply", mid: ctx.message.body.mid },
    });
  });

  bot.on("bot_started", async (ctx) => {
    const payload = ctx.startPayload;
    const extra =
      payload != null && payload !== ""
        ? `\n\nДанные из ссылки: \`${String(payload).slice(0, 120)}\``
        : "";
    await ctx.reply(`Диалог открыт.${extra}`, { format: "markdown" });
  });
}

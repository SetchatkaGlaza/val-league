import { Markup } from 'telegraf';
import config from '../config.js';

export function registerHelpHandlers(bot) {
  bot.command('help', ctx => ctx.reply(
    'VAL — VOLOGDA AMATEUR LEAGUE\n\nБот предназначен для уведомлений о командах и турнирах. Чтобы получать персональные сообщения, привяжи Telegram в аккаунте на сайте.\n\n/start — меню\n/help — помощь\n/privacy — конфиденциальность',
    Markup.inlineKeyboard([[Markup.button.url('Открыть VAL', config.VAL_SITE_URL)], [Markup.button.url('Политика конфиденциальности', config.VAL_PRIVACY_URL)]])
  ));
  bot.command('privacy', ctx => ctx.reply(
    'Бот использует Telegram ID и доступные имя/username для привязки аккаунта и доставки выбранных уведомлений. Не отправляй боту пароли или платёжные данные. Подробнее — в политике VAL.',
    Markup.inlineKeyboard([[Markup.button.url('Политика VAL', config.VAL_PRIVACY_URL)]])
  ));
}

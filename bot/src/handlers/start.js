import { Markup } from 'telegraf';
import config from '../config.js';
import { confirmTelegramLink } from '../services/val-api.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,256}$/;
export function registerStartHandlers(bot) {
  bot.start(async ctx => {
    const payload = String(ctx.startPayload || '');
    if (payload.startsWith('link_')) {
      const token = payload.slice(5);
      if (!TOKEN_RE.test(token)) return ctx.reply('Ссылка привязки некорректна. Создай новую в личном кабинете VAL.');
      try {
        await confirmTelegramLink({token, telegram:{
          id:String(ctx.from.id), username:ctx.from.username || null,
          firstName:ctx.from.first_name || null, lastName:ctx.from.last_name || null
        }});
        return ctx.reply('Telegram успешно привязан к VAL. Ты сможешь получать уведомления, включённые в настройках аккаунта.',
          Markup.inlineKeyboard([[Markup.button.url('Открыть VAL', config.VAL_SITE_URL)]]));
      } catch (e) {
        if ([404,501].includes(e.status)) return ctx.reply('Привязка ещё не подключена на стороне сайта VAL. Попробуй позже.');
        if ([400,409,410].includes(e.status)) return ctx.reply('Ссылка недействительна, использована или устарела. Создай новую ссылку в аккаунте VAL.');
        console.error('Telegram link confirmation failed:', e.message);
        return ctx.reply('Не удалось связаться с VAL. Попробуй позже.');
      }
    }
    return ctx.reply('Добро пожаловать в VAL — VOLOGDA AMATEUR LEAGUE!\n\nЗдесь будут уведомления о командах и турнирах. Для начала открой сайт и привяжи Telegram в личном кабинете.',
      Markup.inlineKeyboard([[Markup.button.url('Открыть сайт VAL', config.VAL_SITE_URL)], [Markup.button.callback('Как это работает','val_help')]]));
  });
  bot.action('val_help', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('Открой аккаунт на сайте VAL, создай одноразовую ссылку привязки Telegram и перейди по ней. Не пересылай ссылку другим людям.');
  });
}

require('dotenv').config();
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { chunk } from "lodash";
import express, { Request, Response } from "express";
import { applyTextEffect, Variant } from "./textEffects";
import axios from 'axios';
import type { Variant as TextEffectVariant } from "./textEffects";

// Constants and Type Definitions
const bot = new Bot(process.env.TELEGRAM_TOKEN || "");
const PORT = process.env.PORT || 3005;
const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:3005/webhook';
const app = express();
const allEffects: { code: TextEffectVariant; label: string }[] = [
  { code: 'w', label: 'Monospace' }, { code: 'b', label: 'Bold' },
  { code: 'i', label: 'Italic' }, { code: 'd', label: 'Doublestruck' },
  { code: 'o', label: 'Circled' }, { code: 'q', label: 'Squared' }
];
const introductionMessage = `Hello! I'm a Telegram bot to help facilitate utilizing Webhooks`;
const aboutUrlKeyboard = new InlineKeyboard().url("Website URL", "https://www.google.com/");

// Helper Functions
const effectCallbackCodeAccessor = (effectCode: TextEffectVariant) => `effect-${effectCode}`;
const findEffectByLabel = (label: string) => allEffects.find((effect) => effect.label.toLowerCase() === label.toLowerCase())?.code;
const createInlineKeyboard = (effectCodes: string[]) => {
  const keyboard = new InlineKeyboard();
  chunk(effectCodes.map(code => allEffects.find(effect => effect.code === code)), 3)
  .forEach(chunk => chunk.forEach(effect => effect && keyboard.text(effect.label, effectCallbackCodeAccessor(effect.code)).row()));
return keyboard;
};
const textEffectResponse = (original: string, modified?: string) => `Original: ${original}${modified ? `\nModified: ${modified}` : ''}`;

// Exception Handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception: ', error);
  // todo: good spot to perform cleanup of operations / open handles
  // todo: maybe restart automatically?
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // todo: more extensive logging here if desired
});

// Bot Command Handlers
bot.command('yo', (ctx) => ctx.reply(`Yo ${ctx.from?.username}`));
bot.command('effect', ctx => ctx.reply(textEffectResponse(ctx.match), { reply_markup: createInlineKeyboard(allEffects.map(e => e.code)) }));
bot.command('start', ctx => ctx.reply(introductionMessage, {reply_markup: aboutUrlKeyboard, parse_mode: 'HTML'}));
bot.command('webhook', ctx => sendDataToWebhook(ctx.match));

// Inline Query Handler
bot.inlineQuery(/effect (monospace|bold|italic) (.*)/, async (ctx) => {
  if (!Array.isArray(ctx.match)) {
    console.error('ctx.match is not an array');
    return;
  }

  const [_, label, originalText] = ctx.match;

  const effectCode = findEffectByLabel(label);
  if (!effectCode) {
    console.error('effect code not found for: ', label);
    return;
  }
  
  const modifiedText = applyTextEffect(originalText, findEffectByLabel(label) as Variant);

  await ctx.answerInlineQuery([
    {
      type: 'article',
      id: 'text-effect',
      title: 'Text Effects',
      input_message_content: {
        message_text: textEffectResponse(originalText, modifiedText),
        parse_mode: 'HTML'
      },
      reply_markup: aboutUrlKeyboard,
      url: 'http://t.me/',
      description: 'Create stylish Unicode text, all within Telegram.'
    }
  ], { cache_time: 30 * 24 * 3600 });
});

// Parse the text effect response
const parseTextEffectResponse = (response: string): { originalText: string, modifiedText?: string } => {
  const originalTextMatch = response.match(/Original: (.*)/);
  const modifiedTextWatch = response.match(/Modified: (.*)/);

  return {
    originalText: originalTextMatch ? originalTextMatch[1] : '',
    modifiedText: modifiedTextWatch ? modifiedTextWatch[1] : undefined
  };
};

// callback handler
allEffects.forEach(effect => bot.callbackQuery(effectCallbackCodeAccessor(effect.code), async ctx => {
  // keyboard.text(effect.label, `callback_data:${effect.code}`).row();
  const { originalText } = parseTextEffectResponse(ctx.msg?.text || '');
  const modifiedText = applyTextEffect(originalText, effect.code);
  await ctx.editMessageText(textEffectResponse(originalText, modifiedText), 
  { reply_markup: createInlineKeyboard(allEffects.map(e => e.code).filter(code => code !== effect.code)) });
}));

// Webhook Route
app.post(`/webhook`, async (req: Request, res: Response) => {
  console.log(`webhook triggered: `, req.body);
  res.status(200).send(`data recvd`);
});

// Bot Server Start Logic
if (process.env.NODE_ENV === 'production') {
  console.log('Webhook URL from .env:', process.env.WEBHOOK_URL);
  app.use(express.json());
  app.use(webhookCallback(bot, 'express'));
  app.listen(PORT, () => console.log(`Bot listening on port ${PORT}`));
  bot.start();
} else {
  bot.start();
  console.log('Bot started in long polling mode without webhooks');
}

// Webhook Send Functions
async function sendDataToWebhook(data: string) {
  try {
    const headers = {
      'Content-Type': 'text/plain',
      'User-Agent': 'PostmanRuntime/7.36.0' // mimicing postman user-agent to try and avoid 403
    };
    const payload = { data };

    // Log the payload and headers before sending
    console.log('Sending the following data to the webhook:');
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('Headers:', headers);

    await axios.post(webhookUrl, payload, { headers: headers});
    console.log('data sent to webhook successfully');
  } catch (error) {
    // Improved error logging
    console.error('An error occurred while sending data to the webhook:');
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Log detailed response error
        console.error('Response error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        });
      } else if (error.request) {
        // Log request details if no response
        console.error('No response received, request details:', error.request);
      } else {
        // Log the error message if request setup failed
        console.error('Error setting up the request:', error.message);
      }
    } else {
      // Log error if it's not an AxiosError
      console.error(error);
    }
  }
}
const https = require('https');
const logger = require('../utils/logger');
const { delay } = require('../utils/delay');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '';
const MAX_MESSAGE_LENGTH = 4000;

function isConfigured() {
  return BOT_TOKEN.length > 0 && CHAT_ID.length > 0;
}

function getBotToken() {
  return BOT_TOKEN;
}

/**
 * Strip control characters, collapse whitespace, and truncate to MAX_MESSAGE_LENGTH.
 */
function cleanMessage(message) {
  if (!message) return '';
  let cleaned = message
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    cleaned = cleaned.substring(0, MAX_MESSAGE_LENGTH - 50) + '\n\n... (message truncated)';
  }
  return cleaned;
}

/**
 * Low-level HTTPS POST to the Telegram Bot API.
 */
function httpPost(path, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          if (body.trim().startsWith('<html>')) { resolve({ ok: false, description: 'HTML response' }); return; }
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ ok: false, description: e.message });
        }
      });
    });

    req.on('error', (e) => resolve({ ok: false, description: e.message }));
    req.setTimeout(35000, () => { req.destroy(); resolve({ ok: false, description: 'Timeout' }); });
    req.write(data);
    req.end();
  });
}

/**
 * Returns true if the Telegram API error is transient and worth retrying.
 * Permanent errors (blocked, invalid token, deactivated user) are not retried.
 */
function isRetryableError(description = '') {
  const permanent = ['bot was blocked', 'chat not found', 'user is deactivated', 'bot token', 'Unauthorized'];
  return !permanent.some((msg) => description.toLowerCase().includes(msg.toLowerCase()));
}

/**
 * Send a text message to a chat.
 * Retries up to `retries` times with exponential backoff: 2s, 4s, 8s.
 */
async function sendMessage(text, chatId = CHAT_ID, replyMarkup = null, retries = 3) {
  if (!isConfigured()) {
    logger.warn('Telegram is not configured. Message not sent.');
    return false;
  }

  const payload = { chat_id: chatId, text: cleanMessage(text), parse_mode: 'Markdown' };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await httpPost(`/bot${BOT_TOKEN}/sendMessage`, payload);
    if (res.ok) { logger.info('Telegram message sent'); return true; }

    logger.warn(`Attempt ${attempt}/${retries} failed — error_code: ${res.error_code || '-'}, description: ${res.description || '-'}`);

    if (!isRetryableError(res.description)) {
      logger.error(`Permanent Telegram error, skipping retry: ${res.description}`);
      break;
    }

    if (attempt < retries) {
      const wait = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      logger.info(`Waiting ${wait}ms before retry...`);
      await delay(wait);
    }
  }

  logger.error('Failed to send Telegram message after all retries');
  return false;
}

/**
 * Answer a callback query (used with inline keyboards).
 */
async function answerCallbackQuery(callbackQueryId, text = '') {
  const res = await httpPost(`/bot${BOT_TOKEN}/answerCallbackQuery`, { callback_query_id: callbackQueryId, text });
  return res.ok;
}

/**
 * Fetch pending updates via long polling.
 * Returns an empty array on any error so the polling loop can continue safely.
 */
async function getUpdates(offset = 0) {
  if (!isConfigured()) return [];

  const params = new URLSearchParams({
    offset: String(offset),
    timeout: '30',
    allowed_updates: JSON.stringify(['message', 'callback_query']),
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/getUpdates?${params}`,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (data.trim().startsWith('<html>')) { logger.error('HTML response from Telegram'); resolve([]); return; }
          const response = JSON.parse(data);
          if (!response.ok) { logger.error(`Telegram error: ${response.description}`); resolve([]); return; }
          resolve(response.result || []);
        } catch (e) {
          logger.error(`Parse error: ${e.message}`);
          resolve([]);
        }
      });
    });

    req.on('error', (e) => { logger.error(`getUpdates error: ${e.message}`); resolve([]); });
    req.setTimeout(35000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

/**
 * Validate the bot token by calling getMe.
 */
async function validateToken() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/getMe`,
      method: 'GET',
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).ok === true); } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

module.exports = { sendMessage, answerCallbackQuery, getUpdates, validateToken, isConfigured, getBotToken };

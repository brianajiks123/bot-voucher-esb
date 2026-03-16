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

function cleanMessage(message) {
  if (!message) return '';
  let cleaned = message
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    cleaned = cleaned.substring(0, MAX_MESSAGE_LENGTH - 50) + '\n\n... (pesan dipotong)';
  }
  return cleaned;
}

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
 * Send text message to a specific chat
 */
async function sendMessage(text, chatId = CHAT_ID, replyMarkup = null, retries = 3) {
  if (!isConfigured()) {
    logger.warn('Telegram tidak dikonfigurasi. Pesan tidak dikirim.');
    return false;
  }

  const payload = { chat_id: chatId, text: cleanMessage(text), parse_mode: 'Markdown' };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await httpPost(`/bot${BOT_TOKEN}/sendMessage`, payload);
    if (res.ok) { logger.info('Pesan Telegram terkirim'); return true; }
    logger.warn(`Attempt ${attempt} gagal: ${res.description}`);
    if (attempt < retries) await delay(attempt * 1000);
  }

  logger.error('Gagal mengirim pesan Telegram setelah semua retry');
  return false;
}

/**
 * Answer callback query
 */
async function answerCallbackQuery(callbackQueryId, text = '') {
  const res = await httpPost(`/bot${BOT_TOKEN}/answerCallbackQuery`, { callback_query_id: callbackQueryId, text });
  return res.ok;
}

/**
 * Get updates from Telegram (long polling)
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
          if (data.trim().startsWith('<html>')) { logger.error('HTML response dari Telegram'); resolve([]); return; }
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
 * Validate bot token with getMe
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

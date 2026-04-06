const { sendMessage } = require('./telegramClient');

function esc(text) {
  return String(text).replace(/[_*`[]/g, '\\$&');
}

function reply(chatId, text, replyMarkup) {
  return sendMessage(text, chatId, replyMarkup || null);
}

function parseCommand(text) {
  return text ? text.trim().toLowerCase().replace(/@\S+$/, '') : '';
}

function extractInlineData(rawText) {
  const spaceIdx = rawText.indexOf(' ');
  if (spaceIdx === -1) return null;
  const data = rawText.slice(spaceIdx + 1).trim();
  return data.length > 0 ? data : null;
}

function parseCodesAndDate(text) {
  const parts = text.split('|').map((p) => p.trim());
  const codes = parts[0].split(',').map((c) => c.trim()).filter(Boolean);
  if (codes.length === 0) return null;

  let date;
  if (parts.length >= 2) {
    date = parts[1];
    const match = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    if (isNaN(new Date(`${yyyy}-${mm}-${dd}`).getTime())) return null;
  } else {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    date = `${dd}-${mm}-${today.getFullYear()}`;
  }
  return { codes, date };
}

function parseCodesForActivate(text) {
  return parseCodesAndDate(text);
}

module.exports = { esc, reply, parseCommand, extractInlineData, parseCodesAndDate, parseCodesForActivate };

# Bot Voucher ESB

Telegram bot to upload and manage vouchers on ESB ERP. Integrates directly with the `esb-voucher-upload-activation` orchestrator — no need to run both projects separately.

## Requirements

- Node.js >= 18
- `esb-voucher-upload-activation` project in the same parent directory
- Telegram Bot Token
- Access to ESB ERP

## 1. Get Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the **Bot Token** (e.g. `123456789:AAFxxxxxxxx`) → use as `TELEGRAM_BOT_TOKEN` in `.env`

## 2. Get Telegram Chat ID

1. Start a conversation with your bot and send `/start`
2. Open: `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`
3. Find `"chat": { "id": 987654321 }` → use as `TELEGRAM_CHAT_ID` in `.env`

> If the response is empty, send another message to your bot first, then refresh.

## 3. Installation

```bash
npm install
cd ../esb-voucher-upload-activation && npm install
```

## 4. Configuration

```bash
cp .env.example .env
```

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
ESB_BASE_URL=erp_base_url
ESB_USERNAME=your_esb_username
ESB_PASSWORD=your_esb_password
SHOW_BROWSER=false
LOG_LEVEL=debug
NODE_ENV=development
```

`SHOW_BROWSER=true` shows the browser window during automation. `false` runs headless (default).

## 5. Running Bot

```bash
# Development
npm start

# Production (PM2)
pm2 start ecosystem.config.js
```

**Useful PM2 commands:**

```bash
pm2 logs BOT-VOUCHER-ESB
pm2 status
pm2 restart BOT-VOUCHER-ESB
pm2 stop BOT-VOUCHER-ESB
pm2 save
pm2 startup
```

## 6. Usage via Telegram

| Command | Description |
|---|---|
| `/start` | Show bot info and available commands |
| `/create` | Upload new vouchers (CREATE mode) |
| `/activate` | Activate vouchers (ACTIVATE mode) |
| `/check` | Check voucher info by code |
| `/extend` | Extend voucher expiry date |
| `/delete` | Delete vouchers |
| `/status` | Check current bot status |
| `/help` | Show usage guide |

**Upload voucher:**
1. Send `/create` or `/activate`
2. Send your `.xlsx` or `.xls` file
3. Bot processes and sends a detailed result per file

**Extend voucher (2 ways):**
- Inline: `/extend KODE1, KODE2 | DD-MM-YYYY`
- Two-step: send `/extend`, then send `KODE1, KODE2 | DD-MM-YYYY`

If the Update button is not available, bot replies with the current voucher status as the reason.

**Delete voucher (2 ways):**
- Inline: `/delete KODE1, KODE2 | DD-MM-YYYY`
- Two-step: send `/delete`, then send `KODE1, KODE2 | DD-MM-YYYY`

If the Delete button is not available, bot replies with the current voucher status as the reason.

## 7. Notes

- Only 1 process can run at a time
- Session expires in **5 minutes** after sending the command
- Temp files are automatically deleted after processing

## 8. Logs

```bash
tail -f logs/combined.log
tail -f logs/error.log
```

## 9. Telegram Group Setup

The bot supports group chats. `message.chat.id` and `message.from.id` are handled separately so per-user state works correctly in groups.

1. Add your bot to the group and make it an **admin**
2. Disable **privacy mode** via [@BotFather](https://t.me/BotFather) → `/mybots` → Group Privacy → Turn off
3. Get the Group Chat ID (negative number, e.g. `-1001234567890`) from `getUpdates`
4. Update `.env`: `TELEGRAM_CHAT_ID=-1001234567890`

> In groups with multiple bots, use `/command@botusername` format.

## Documentation

- [`docs/FLOW.md`](docs/FLOW.md) — process flow
- [`docs/STRUCTURE.md`](docs/STRUCTURE.md) — project structure

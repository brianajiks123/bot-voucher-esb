# Bot Voucher ESB

Telegram bot to upload and activate vouchers to ESB ERP via Excel file. Integrates directly with the `voucher-upload-activation-esb` orchestrator — no need to run both projects separately.

## Requirements

- Node.js >= 18
- `voucher-upload-activation-esb` project in the same parent directory
- Telegram Bot Token
- Access to ESB ERP

## 1. Get Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Follow the prompts — enter a name and username for your bot
4. BotFather will reply with your **Bot Token**, e.g.:
   ```
   123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
5. Copy and save the token — use it as `TELEGRAM_BOT_TOKEN` in `.env`

## 2. Get Telegram Chat ID

1. Start a conversation with your bot — search for its username and send `/start`
2. Open this URL in your browser (replace `<BOT_TOKEN>` with your actual token):
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
   ```
3. Look for the `"chat"` object in the response:
   ```json
   "chat": {
     "id": 987654321,
     "type": "private"
   }
   ```
4. Copy the `id` value — use it as `TELEGRAM_CHAT_ID` in `.env`

> If the response is empty, send another message to your bot first, then refresh the URL.

## 3. Installation

```bash
# Install bot dependencies
npm install

# Install sibling project dependencies (required for Puppeteer)
cd ../voucher-upload-activation-esb && npm install
```

## 4. Configuration

```bash
cp .env.example .env
```

Fill `.env`:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# ESB ERP
ESB_BASE_URL=erp_base_url

# Credentials ESB ERP
ESB_USERNAME=your_esb_username
ESB_PASSWORD=your_esb_password

# Logger (default: debug)
LOG_LEVEL=debug
NODE_ENV=development
```

## 5. Running Bot

```bash
# Development
npm start

# Production (PM2)
pm2 start ecosystem.config.js
```

Only this project needs to be running. The `esb-voucher-upload-activation` project is used as a library — its orchestrator is called directly within the same process.

**Useful PM2 commands:**

```bash
pm2 logs BOT-VOUCHER-ESB       # Stream live logs
pm2 status                     # Check running status
pm2 restart BOT-VOUCHER-ESB    # Restart the bot
pm2 stop BOT-VOUCHER-ESB       # Stop the bot
pm2 save                       # Save process list (persist after reboot)
pm2 startup                    # Auto-start PM2 on system boot
```

## 6. Usage via Telegram

| Command | Description |
|---|---|
| `/start` | Show bot info and available commands |
| `/create` | Start upload new vouchers (CREATE mode) |
| `/activate` | Start activate vouchers (ACTIVATE mode) |
| `/status` | Check current bot status |
| `/help` | Show usage guide |

**How to upload:**
1. Send `/create` or `/activate`
2. Bot will prompt you to send an Excel file
3. Send your `.xlsx` or `.xls` file
4. Bot processes the file and sends a detailed result per file

## 7. Notes

- Only 1 process can run at a time
- Upload session expires in **5 minutes** after sending the command
- Temp files are automatically deleted after processing (success or failed)
- If any file fails, bot shows the error detail and instructions to re-upload

## 8. Logs

```bash
# Real-time log
tail -f logs/combined.log

# Error log only
tail -f logs/error.log
```

## Documentation

- [`docs/FLOW.md`](docs/FLOW.md) — process flow
- [`docs/STRUCTURE.md`](docs/STRUCTURE.md) — project structure

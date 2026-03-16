# Process Flow

## Overview

Telegram bot that receives an Excel file from a user and uploads it to ESB ERP via the `voucher-upload-activation-esb` orchestrator. Supports 2 modes:

| Mode     | Command     | Description                  | ESB codeMode |
|----------|-------------|------------------------------|--------------|
| CREATE   | `/create`   | Add new vouchers to ESB ERP  | 1            |
| ACTIVATE | `/activate` | Activate existing vouchers   | 3            |

---

## Bot Startup Flow

```
node index.js
      │
      ├─ sendStartNotification()   ← Send start message to Telegram
      └─ startBot()                ← Start long polling loop
            │
            └─ getUpdates() loop  ← Waiting for user messages
```

---

## CREATE / ACTIVATE Flow

```
User sends /create (or /activate)
      │
      ▼
Bot sets user state: { mode: 'CREATE', expiresAt: now + 5min }
Bot replies: "Please send your Excel file..."
      │
      ▼
User sends file .xlsx / .xls
      │
      ▼
handleDocument()
      │
      ├─ Check user state → if no state: reply "Send /create first"
      ├─ Validate file extension → if not .xlsx/.xls: reply format error
      │
      ▼
processVoucherUpload()
      │
      ├─ Check isProcessing → if true: reply "Process already running"
      ├─ Set isProcessing = true
      ├─ Clear user state
      ├─ Reply: "Processing... please wait"
      │
      ├─ createTempFolder()          ← Create isolated folder: files/tmp/<ts>-<userId>-<mode>/
      ├─ downloadTelegramFile()      ← getFile API → download file to temp folder
      │
      ├─ voucherUploadOrchestrate()  ← Required from voucher-upload-activation-esb
      │       │
      │       ├─ Open Puppeteer browser → navigate to ESB login page
      │       ├─ checkLoginStatus() → loginAction() if not logged in
      │       ├─ gotoVoucherMenu()
      │       │
      │       └─ For each file in temp folder:
      │             1. Click "Upload" button
      │             2. Click mode tab (CREATE codeMode=1 / ACTIVATE codeMode=3)
      │             3. Set file to upload input
      │             4. Click submit button
      │             5. Wait for upload queue to finish
      │             6. Save result { file, status, message }
      │       │
      │       └─ Close browser → return results[]
      │
      ├─ sendUploadResultNotification()  ← Send detailed result to user
      │
      └─ deleteTempFolder()          ← Always cleanup (success or failed)
         Set isProcessing = false
```

---

## Error Handling Flow

```
processVoucherUpload()
      │
      ├─ [Fatal error — e.g. login failed, network error]
      │       └─ sendFatalErrorNotification()
      │             ├─ Login/credential error → hint: "Contact admin"
      │             ├─ Timeout/network error  → hint: "Try again later"
      │             └─ Other error            → hint: "Please try again"
      │
      └─ [Per-file error — e.g. element not found, upload timeout]
              └─ Result saved as ✗ Failed, process continues to next file
                 sendUploadResultNotification() shows detail per file
```

---

## Result Notification Format

**All success:**
```
✅ Create Voucher Done

📅 03/16/2026, 14:30:00
📊 Total: 2 | ✅ Success: 2 | ❌ Failed: 0

─────────────────────
1. ✓ `voucher_batch1.xlsx`
2. ✓ `voucher_batch2.xlsx`
```

**Partial failed:**
```
⚠️ Create Voucher Done

📅 03/16/2026, 14:30:00
📊 Total: 2 | ✅ Success: 1 | ❌ Failed: 1

─────────────────────
1. ✓ `voucher_batch1.xlsx`
2. ✗ `voucher_batch2.xlsx`
   └ Element "#btnSubmitUpload" not found after 10s

─────────────────────
⚠️ 1 file(s) failed.
Please re-upload the failed file(s) using /create
```

**Fatal error:**
```
❌ Create Voucher Failed

📅 03/16/2026, 14:30:00

Cause:
`Login to ESB failed — invalid credentials`

💡 ESB credentials may be incorrect or session is broken. Contact admin.

Use /create to try again.
```

---

## State Management

| Condition | Behavior |
|---|---|
| User sends `/create` | State set: `{ mode: 'CREATE', expiresAt: now+5min }` |
| User sends file within 5 minutes | File is processed with the active mode |
| User sends file after 5 minutes | State expired, bot asks to send command again |
| User sends file without command | Bot replies: "Send /create or /activate first" |
| File is not .xlsx/.xls | Bot replies format error, state remains active |
| A process is already running | All upload commands are rejected until done |

---

## Retry Mechanism

Retry is handled by `voucherUploadOrchestrate` at the orchestrator level (not per-file):
- Max retries: **2x**
- Delay between retries: `attempt × 5000ms`
- Per-file errors do not trigger retry — recorded as `✗ Failed` and process continues to the next file

# Process Flow

## Overview

Telegram bot that interacts with ESB ERP via the `esb-voucher-upload-activation` orchestrator.

| Command     | Description                          |
|-------------|--------------------------------------|
| `/create`   | Upload new vouchers via Excel file   |
| `/activate` | Activate existing vouchers via Excel |
| `/check`    | Check voucher info by code           |
| `/extend`   | Extend voucher expiry date           |
| `/delete`   | Delete vouchers                      |
| `/status`   | Check bot status                     |
| `/help`     | Show usage guide                     |

---

## Bot Startup Flow

```
node index.js
      │
      └─ startBot()
            ├─ validateToken()
            ├─ setMyCommands()        ← Register command menu (⊞ button)
            ├─ sendStartNotification() ← Single startup message to Telegram
            └─ getUpdates() loop      ← Long polling for user messages
```

---

## CREATE / ACTIVATE Flow

```
User sends /create (or /activate)
      │
      ▼
Bot sets state: { mode: 'CREATE', expiresAt: now + 5min }
      │
      ▼
User sends file .xlsx / .xls
      │
      ▼
handleDocument() → processVoucherUpload()
      │
      ├─ Reply: "📥 File diterima..."
      ├─ createTempFolder()           ← files/tmp/<ts>-<userId>-<mode>/
      ├─ downloadTelegramFile()       ← Download file to temp folder
      ├─ Reply: "⬆️ Sedang upload..."
      ├─ voucherUploadOrchestrate()   ← Login → navigate → upload → return results[]
      ├─ sendUploadResultNotification()
      └─ deleteTempFolder()           ← Always cleanup
```

---

## CHECK Flow

```
User sends /check
      │
      ▼
Bot sets state: { mode: 'CHECK', expiresAt: now + 5min }
      │
      ▼
User sends voucher codes (comma-separated)
      │
      ▼
processVoucherCheck() → checkVoucherCodes() → reply per voucher
```

---

## EXTEND Flow

```
Option A — Inline (single message):
  User sends: /extend KODE1, KODE2 | DD-MM-YYYY
        │
        ▼
  extractInlineData() → processExtend() directly

Option B — Two-step:
  User sends /extend
        │
        ▼
  Bot sets state: { mode: 'EXTEND', expiresAt: now + 5min }
  Bot replies: format prompt
        │
        ▼
  User sends: KODE1, KODE2 | DD-MM-YYYY
        │
        ▼
  processExtend()

processExtend():
  ├─ parseCodesAndDate() — validate format
  ├─ extendVoucherCodes(credentials, codes, date)
  │     └─ For each code:
  │           1. Filter table by voucher code
  │           2. Check row checkbox
  │           3. Look for btnUpdate
  │              ├─ NOT found → { found: true, buttonAvailable: false, status }
  │              └─ Found → fill new end date → confirm → { success: true }
  └─ Reply with per-voucher result summary
        ✅ success | ❌ not_found | ⚠️ button_unavailable (status: X)
```

---

## DELETE Flow

```
Option A — Inline (single message):
  User sends: /delete KODE1, KODE2 | DD-MM-YYYY
        │
        ▼
  extractInlineData() → processDelete() directly

Option B — Two-step:
  User sends /delete
        │
        ▼
  Bot sets state: { mode: 'DELETE', expiresAt: now + 5min }
  Bot replies: format prompt
        │
        ▼
  User sends: KODE1, KODE2 | DD-MM-YYYY
        │
        ▼
  processDelete()

processDelete():
  ├─ parseCodesAndDate() — validate format
  ├─ deleteVoucherCodes(credentials, codes, date)
  │     └─ For each code:
  │           1. Filter table by voucher code
  │           2. Check row checkbox
  │           3. Look for btnDelete
  │              ├─ NOT found → { found: true, buttonAvailable: false, status }
  │              └─ Found → modal: Purpose (Select2) + Journal Date → Process
  └─ Reply with per-voucher result summary
        ✅ success | ❌ not_found | ⚠️ button_unavailable (status: X)
```

---

## Reply Keyboard Flow

```
Every bot response includes mainKeyboard() — persistent reply keyboard:
  ┌──────────┬───────────┐
  │ /create  │ /activate │
  ├──────────┼───────────┤
  │ /check   │ /extend   │
  ├──────────┼───────────┤
  │ /delete  │ /status   │
  ├──────────┴───────────┤
  │ /help                │
  └──────────────────────┘
```

---

## Error Handling

```
processVoucherUpload()
  ├─ Fatal error (login failed, network error)
  │     └─ sendFatalErrorNotification() with contextual hint
  └─ Per-file error
        └─ Recorded as ✗ Failed, process continues to next file

processExtend() / processDelete()
  ├─ Voucher not found → ❌ per code
  ├─ Button not available → ⚠️ with current voucher status
  └─ Unexpected error → ❌ with error message
```

---

## State Management

| Condition | Behavior |
|---|---|
| User sends `/create` or `/activate` | State set with 5-min TTL, waits for file |
| User sends `/check` | State set, waits for codes |
| User sends `/extend` or `/delete` | State set, waits for "CODES \| DATE" |
| User sends `/extend CODES \| DATE` | Processed inline, no state needed |
| User sends `/delete CODES \| DATE` | Processed inline, no state needed |
| State expired | Bot asks to send command again |
| A process is already running | Upload commands rejected until done |

---

## Retry Mechanism

Retry is handled by `voucherUploadOrchestrate` at the orchestrator level (not per-file):
- Max retries: **2x**
- Delay between retries: `attempt × 5000ms`
- Per-file errors do not trigger retry — recorded as `✗ Failed` and process continues

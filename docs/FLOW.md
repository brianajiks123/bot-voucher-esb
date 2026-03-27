# Process Flow

## Overview

Telegram bot that interacts with ESB ERP via the `esb-voucher-upload-activation` orchestrator.

| Command     | Description                                              |
|-------------|----------------------------------------------------------|
| `/create`   | Upload new vouchers via Excel file                       |
| `/activate` | Activate vouchers — via Excel file or input voucher codes |
| `/check`    | Check voucher info by code                               |
| `/extend`   | Extend voucher expiry date                               |
| `/delete`   | Delete vouchers                                          |
| `/status`   | Check bot status                                         |
| `/help`     | Show usage guide                                         |

---

## Bot Startup Flow

```
node index.js
      │
      └─ startBot()
            ├─ validateToken()
            ├─ setMyCommands()         ← Register command menu (⊞ button)
            ├─ sendStartNotification() ← Single startup message to Telegram
            └─ getUpdates() loop       ← Long polling for messages + callback_query
```

---

## Branch Selection Flow

All commands (except `/status` and `/help`) require branch selection before proceeding.

```
User sends command (e.g. /create, /activate, /check, /extend, /delete)
      │
      ▼
askBranch() → setState: { mode: 'BRANCH_SELECT', pendingMode, pendingData }
      │
      ▼
User replies with branch name (e.g. "IDEO", "VENTURA", "BSB")
      │
      ▼
handleBranchReply() → resolveBranchKey() → getCredentialsForBranch()
      │
      ▼
Resume pending flow with resolved credentials
```

**Supported branches:**

| Input           | Branch Display        | Credential Group |
|-----------------|-----------------------|------------------|
| IDEO            | IDEOLOGIS+            | IMVB             |
| VENTURA         | MAARI VENTURA         | IMVB             |
| BSB             | MAARI BSB             | IMVB             |
| BURGAS GOMBEL   | BURJO NGEGAS GOMBEL   | BURGAS           |
| BURGAS PLEBURAN | BURJO NGEGAS PLEBURAN | BURGAS           |

---

## CREATE Flow

```
User sends /create
      │
      ▼
askBranch() → user selects branch
      │
      ▼
setState: { mode: 'CREATE', credentials }
Bot prompts: "Kirim file Excel..."
      │
      ▼
User sends .xlsx / .xls file
      │
      ▼
handleDocument() → processVoucherUpload(mode: 'CREATE')
      │
      ├─ createTempFolder()
      ├─ downloadTelegramFile()
      ├─ voucherUploadOrchestrate()   ← Login → navigate → upload → return results[]
      ├─ sendUploadResultNotification()
      ├─ sendErrorFileToTelegram()    ← If any file failed with error Excel
      └─ deleteTempFolder()           ← Always cleanup
```

---

## ACTIVATE Flow

```
User sends /activate
      │
      ▼
Bot presents inline keyboard:
  ┌─────────────────────┬──────────────────────┐
  │  📁 Via File Excel  │  🔑 Input Kode Voucher │
  └─────────────────────┴──────────────────────┘
      │
      ├─ User taps "Via File Excel"
      │       │
      │       ▼
      │   askBranch() → user selects branch
      │       │
      │       ▼
      │   setState: { mode: 'ACTIVATE', credentials }
      │   Bot prompts: "Kirim file Excel..."
      │       │
      │       ▼
      │   User sends .xlsx / .xls file
      │       │
      │       ▼
      │   processVoucherUpload(mode: 'ACTIVATE')
      │   (same flow as CREATE)
      │
      └─ User taps "Input Kode Voucher"
              │
              ▼
          askBranch() → user selects branch
              │
              ▼
          setState: { mode: 'ACTIVATE_CODE', credentials }
          Bot prompts: "Kirim kode voucher..."
              │
              ▼
          User sends: KODE1, KODE2  or  KODE1, KODE2 | DD-MM-YYYY
              │
              ▼
          processActivateByCode()
              │
              ▼
          activateVoucherByCodes(credentials, codes, purpose='voucher', date)
              │
              ▼
          For each code:
            1. checkVoucherByCode() — get current status
            2. Status != 'available' → record { reason: 'not_available', status }
            3. Status == 'available' → activateVoucherByCode()
                  ├─ Filter table → check checkbox → click btnActivate
                  ├─ Modal: fill Purpose (Select2) + Date to Activate
                  └─ Click Save → waitForNavigation
              │
              ▼
          Reply with per-voucher result summary

Notes:
  - Sending a file while in ACTIVATE_CODE mode → rejected
  - Sending plain text while in ACTIVATE (file) mode → rejected
  - Purpose is hardcoded as 'voucher' (not user-facing)
  - Date defaults to today if not provided
```

---

## CHECK Flow

```
User sends /check
      │
      ▼
askBranch() → user selects branch
      │
      ▼
setState: { mode: 'CHECK', credentials }
Bot prompts: "Kirim kode voucher..."
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
Option A — Inline:
  /extend KODE1, KODE2
  /extend KODE1, KODE2 | DD-MM-YYYY
        │
        ▼
  extractInlineData() → askBranch() → processExtend()

Option B — Two-step:
  /extend → askBranch() → user selects branch
        │
        ▼
  setState: { mode: 'EXTEND', credentials }
  Bot prompts: format instructions
        │
        ▼
  User sends: KODE1, KODE2  or  KODE1, KODE2 | DD-MM-YYYY
        │
        ▼
  processExtend()

processExtend():
  ├─ parseCodesAndDate() — codes required, date optional (default: today)
  ├─ extendVoucherCodes(credentials, codes, date)
  │     └─ For each code:
  │           1. Filter table by voucher code
  │           2. Check row checkbox
  │           3. Look for btnUpdate
  │              ├─ NOT found → { found: true, buttonAvailable: false, status }
  │              └─ Found → fill new end date → confirm → { success: true }
  └─ Reply with per-voucher result summary
        OK | TIDAK DITEMUKAN | TIDAK DAPAT DIPROSES (status: X) | GAGAL
```

---

## DELETE Flow

```
Option A — Inline:
  /delete KODE1, KODE2
  /delete KODE1, KODE2 | DD-MM-YYYY
        │
        ▼
  extractInlineData() → askBranch() → processDelete()

Option B — Two-step:
  /delete → askBranch() → user selects branch
        │
        ▼
  setState: { mode: 'DELETE', credentials }
  Bot prompts: format instructions
        │
        ▼
  User sends: KODE1, KODE2  or  KODE1, KODE2 | DD-MM-YYYY
        │
        ▼
  processDelete()

processDelete():
  ├─ parseCodesAndDate() — codes required, date optional (default: today)
  ├─ deleteVoucherCodes(credentials, codes, date)
  │     └─ For each code:
  │           1. Filter table by voucher code
  │           2. Check row checkbox
  │           3. Look for btnDelete
  │              ├─ NOT found → { found: true, buttonAvailable: false, status }
  │              └─ Found → modal: Purpose (Select2) + Journal Date → Process
  └─ Reply with per-voucher result summary
        OK | TIDAK DITEMUKAN | TIDAK DAPAT DIPROSES (status: X) | GAGAL
```

---

## Callback Query Flow

```
User taps inline keyboard button (e.g. activate options)
      │
      ▼
handleCallbackQuery()
      ├─ answerCallbackQuery()   ← Dismiss loading spinner
      ├─ 'activate_file'  → askBranch(pendingMode: 'ACTIVATE')
      └─ 'activate_code'  → askBranch(pendingMode: 'ACTIVATE_CODE')
```

---

## Reply Keyboard

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

processActivateByCode()
  ├─ Voucher not found         → TIDAK DITEMUKAN
  ├─ Status != available       → TIDAK DAPAT DIPROSES (status: X)
  ├─ Button not available      → TIDAK DAPAT DIPROSES (tombol tidak tersedia)
  └─ Unexpected error          → GAGAL with error message

processExtend() / processDelete()
  ├─ Voucher not found         → TIDAK DITEMUKAN
  ├─ Button not available      → TIDAK DAPAT DIPROSES (status: X)
  └─ Unexpected error          → GAGAL with error message
```

---

## State Management

| State               | Triggered by                        | Waits for                          |
|---------------------|-------------------------------------|------------------------------------|
| `BRANCH_SELECT`     | Any command needing branch          | Branch name text reply             |
| `CREATE`            | After branch selected for /create   | Excel file upload                  |
| `ACTIVATE`          | After branch selected (file option) | Excel file upload                  |
| `ACTIVATE_CODE`     | After branch selected (code option) | Voucher codes text                 |
| `CHECK`             | After branch selected for /check    | Voucher codes text                 |
| `EXTEND`            | After branch selected for /extend   | Codes (+ optional date) text       |
| `DELETE`            | After branch selected for /delete   | Codes (+ optional date) text       |
| `ACTIVATE_METHOD_SELECT` | /activate command              | Inline keyboard button tap         |

- All states expire after **5 minutes**
- Only 1 upload/activate/extend/delete process runs at a time (`isProcessing` flag)

---

## Retry Mechanism

Retry is handled by `voucherUploadOrchestrate` at the orchestrator level (not per-file):
- Max retries: **2x**
- Delay between retries: `attempt × 5000ms`
- Per-file errors do not trigger retry — recorded as `✗ Failed` and process continues

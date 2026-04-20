# Process Flow

## Overview

Telegram bot that interacts with ESB ERP via the `esb-voucher-upload-activation` orchestrator.

| Command     | Description                                                        |
|-------------|--------------------------------------------------------------------|
| `/start`    | Show bot info and available commands                               |
| `/create`   | Upload new vouchers — via Excel file or generate from input        |
| `/activate` | Activate vouchers — via Excel file or input voucher codes          |
| `/check`    | Check voucher info by code                                         |
| `/extend`   | Extend voucher expiry date                                         |
| `/delete`   | Delete vouchers                                                    |
| `/restore`  | Restore vouchers                                                   |
| `/status`   | Check bot status                                                   |
| `/help`     | Show usage guide                                                   |

---

## Bot Startup Flow

```
node index.js
      │
      └─ startBot()                    ← bot.js
            ├─ validateToken()
            ├─ setMyCommands()         ← Register command menu (⊞ button)
            ├─ sendStartNotification() ← Single startup message to Telegram
            └─ getUpdates() loop       ← Long polling for messages + callback_query
                  ├─ update.message        → handleMessage()   (handlers/messages.js)
                  └─ update.callback_query → handleCallbackQuery() (handlers/callbacks.js)
```

---

## Branch Selection Flow

Commands `/activate`, `/check`, `/extend`, `/delete`, and `/create` (Via File Excel) require branch selection before proceeding.

```
User sends command
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

| Input                        | Branch Display        | Credential Group |
|------------------------------|-----------------------|------------------|
| IDEO                         | IDEOLOGIS+            | IMVB             |
| VEN, VENTURA                 | MAARI VENTURA         | IMVB             |
| BSB                          | MAARI BSB             | IMVB             |
| GOM, BURGAS GOMBEL           | BURJO NGEGAS GOMBEL   | BURGAS           |
| PLB, BURGAS PLEBURAN         | BURJO NGEGAS PLEBURAN | BURGAS           |

---

## CREATE Flow

```
User sends /create
      │
      ▼
Bot presents inline keyboard:
  ┌─────────────────────┬──────────────┐
  │  📁 Via File Excel  │  ⚡ Generate  │
  └─────────────────────┴──────────────┘
      │
      ├─ User taps "Via File Excel"
      │       │
      │       ▼
      │   askBranch() → user selects branch
      │       │
      │       ▼
      │   setState: { mode: 'CREATE', credentials }
      │   Bot prompts: "Kirim file Excel..."
      │       │
      │       ▼
      │   User sends .xlsx / .xls file
      │       │
      │       ▼
      │   processVoucherUpload(mode: 'CREATE')
      │     ├─ createTempFolder()
      │     ├─ downloadTelegramFile()
      │     ├─ voucherUploadOrchestrate()
      │     ├─ sendUploadResultNotification()
      │     ├─ sendErrorFileToTelegram()   ← if any file failed with error Excel
      │     └─ deleteTempFolder()          ← always cleanup
      │
      └─ User taps "Generate"
              │
              ▼
          Bot presents generate mode keyboard (7 options)
              │
              ▼
          setState: { mode: 'CREATE_GENERATE', credentials: null }
          Bot prompts: format instructions per selected mode
              │
              ▼
          User sends generate input string
              │
              ▼
          processGenerate()
            ├─ generateVouchers(text, baseDir)   ← generate Excel files + zip
            ├─ For each branch folder:
            │     ├─ resolveBranchKey() → getCredentialsForBranch()
            │     └─ voucherUploadOrchestrate(mode: 'CREATE')
            ├─ sendDocument(zipPath)              ← send .zip to user
            └─ cleanup: delete baseDir + zip      ← always in finally block
```

### Generate Modes

| # | Mode                  | Description                                              |
|---|-----------------------|----------------------------------------------------------|
| 1 | Single Mode           | One file for the entire period                           |
| 2 | Multiple Mode         | One file per date                                        |
| 3 | Custom Prefix         | Custom voucher code prefix (quoted, before length)       |
| 4 | Custom Branch         | Custom "Can Use on Branch" value (quoted, after mode)    |
| 5 | Custom Prefix + Branch| Combination of custom prefix and custom branch           |
| 6 | Multiple Amount       | Multiple voucher amounts in one input                    |
| 7 | Multiple Branches     | Multiple branches separated by ` \| `                   |

**Generate input format:**
```
<mode> <branch> ["prefix"] <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"
```

**Custom Branch format** (quoted string replaces branch alias):
```
<mode> "<branch1>, <branch2>" ["prefix"] <len> ... "<notes>"
```

Credentials are resolved automatically per branch from the alias in the input. For Custom Branch, the first alias is used for folder/code generation; all aliases are resolved to full names joined by ` | ` in the "Can Use on Branch (s)" column.

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
              └─ For each code:
                   1. checkVoucherByCode() — get current status
                   2. Status != 'available' → record { reason: 'not_available', status }
                   3. Status == 'available' → activateVoucherByCode()
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
/extend → askBranch() → user selects branch
      │
      ▼
setState: { mode: 'EXTEND', credentials }
      │
      ▼
User sends: KODE1, KODE2  or  KODE1, KODE2 | DD-MM-YYYY
      │
      ▼
processExtend() → extendVoucherCodes(credentials, codes, date)
```

Also supports inline: `/extend KODE1, KODE2 | DD-MM-YYYY` → `extractInlineData()` → `askBranch()` → `processExtend()`

Date is optional — defaults to today.

---

## DELETE Flow

```
/delete → askBranch() → user selects branch
      │
      ▼
setState: { mode: 'DELETE', credentials }
      │
      ▼
User sends: KODE1, KODE2  or  KODE1, KODE2 | DD-MM-YYYY
      │
      ▼
processDelete() → deleteVoucherCodes(credentials, codes, date)
```

Also supports inline: `/delete KODE1, KODE2 | DD-MM-YYYY`

Date is optional — defaults to today.

---

## RESTORE Flow

```
/restore → askBranch() → user selects branch
      │
      ▼
setState: { mode: 'RESTORE', credentials }
      │
      ▼
User sends: KODE1, KODE2  or  KODE1, KODE2 | DD-MM-YYYY
      │
      ▼
processRestore() → restoreVoucherCodes(credentials, codes, date)
```

Also supports inline: `/restore KODE1, KODE2 | DD-MM-YYYY`

Date is optional — defaults to today.

---

## Callback Query Flow

```
User taps inline keyboard button
      │
      ▼
handlers/callbacks.js → answerCallbackQuery()
      │
      ├─ 'create_file'       → askBranch(pendingMode: 'CREATE')
      ├─ 'create_generate'   → show generateModeKeyboard()
      ├─ 'gen_single'        → setState CREATE_GENERATE, prompt format 1
      ├─ 'gen_multiple'      → setState CREATE_GENERATE, prompt format 2
      ├─ 'gen_prefix'        → setState CREATE_GENERATE, prompt format 3
      ├─ 'gen_custom_branch' → setState CREATE_GENERATE, prompt format 4
      ├─ 'gen_prefix_branch' → setState CREATE_GENERATE, prompt format 5
      ├─ 'gen_multi_amount'  → setState CREATE_GENERATE, prompt format 6
      ├─ 'gen_multi_branch'  → setState CREATE_GENERATE, prompt format 7
      ├─ 'activate_file'     → askBranch(pendingMode: 'ACTIVATE')
      └─ 'activate_code'     → askBranch(pendingMode: 'ACTIVATE_CODE')
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
  │ /delete  │ /restore  │
  ├──────────┼───────────┤
  │ /status  │ /help     │
  └──────────┴───────────┘
```

---

## State Management

| State                    | Triggered by                          | Waits for                    |
|--------------------------|---------------------------------------|------------------------------|
| `BRANCH_SELECT`          | Any command needing branch            | Branch name text reply       |
| `CREATE`                 | After branch selected for /create     | Excel file upload            |
| `CREATE_METHOD_SELECT`   | /create command                       | Inline keyboard button tap   |
| `CREATE_GENERATE`        | After generate mode selected          | Generate input text          |
| `ACTIVATE`               | After branch selected (file option)   | Excel file upload            |
| `ACTIVATE_CODE`          | After branch selected (code option)   | Voucher codes text           |
| `ACTIVATE_METHOD_SELECT` | /activate command                     | Inline keyboard button tap   |
| `CHECK`                  | After branch selected for /check      | Voucher codes text           |
| `EXTEND`                 | After branch selected for /extend     | Codes (+ optional date) text |
| `DELETE`                 | After branch selected for /delete     | Codes (+ optional date) text |
| `RESTORE`                | After branch selected for /restore    | Codes (+ optional date) text |

- All states expire after **5 minutes** (managed by `state.js`)
- Only 1 process runs at a time (managed by `processingState.js`)

---

## Error Handling

```
processors/upload.js / processors/generate.js
  ├─ Fatal error (login failed, network error)
  │     └─ sendFatalErrorNotification() with contextual hint
  └─ Per-file error
        └─ Recorded as ✗ Failed, process continues to next file

processors/activate.js
  ├─ Voucher not found         → TIDAK DITEMUKAN
  ├─ Status != available       → TIDAK DAPAT DIPROSES (status: X)
  ├─ Button not available      → TIDAK DAPAT DIPROSES (tombol tidak tersedia)
  └─ Unexpected error          → GAGAL with error message

processors/extend.js / processors/delete.js / processors/restore.js
  ├─ Voucher not found         → TIDAK DITEMUKAN
  ├─ Button not available      → TIDAK DAPAT DIPROSES (status: X)
  └─ Unexpected error          → GAGAL with error message

processors/generate.js
  ├─ Parse error               → ❌ Generate gagal (format tidak valid)
  ├─ Per-branch upload error   → ⚠️ Upload <branch> gagal (process continues)
  └─ Temp files always deleted in finally block
```

---

## Retry Mechanism

Retry is handled by `voucherUploadOrchestrate` at the orchestrator level (not per-file):
- Max retries: **2x**
- Delay between retries: `attempt × 5000ms`
- Per-file errors do not trigger retry — recorded as `✗ Failed` and process continues

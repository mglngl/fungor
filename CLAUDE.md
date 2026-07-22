# TPRM Assessment Planning Tool

**Stack:** Google Apps Script (backend + frontend via `HtmlService`) · Google Sheets (database)  
**Pattern:** Browser → `google.script.run` → `.gs` functions → Sheets. No REST API.

## File Structure

```
appsscript.json     # Manifest, OAuth scopes, webapp config
Code.gs             # doGet(), include(), getInitialData()
DB.gs               # getSpreadsheet(), getSheet(), generateId(), rowToObject(), objectToRow()
Config.gs           # Sheet/header constants, initializeSheets(), getConfigValues()
ThirdParties.gs     # TP CRUD + saveThirdPartyWithLobs(), deleteThirdPartyWithLobs()
LinesOfBusiness.gs  # LOB CRUD (_saveLob, _deleteLob, getLobsByTpId, _deleteLobsByTpId)
Index.html          # HTML shell — uses <?!= include('Stylesheet') ?> and <?!= include('JavaScript') ?>
Stylesheet.html     # <style> block only
JavaScript.html     # <script> block only — all client-side logic
```

## Data Model

### ThirdParties sheet — column order is the source of truth for `objectToRow()`

| # | Field | Values |
|---|---|---|
| A | `tp_id` | `TP-0001` auto-generated |
| B | `name` | |
| C | `alternate_name` | |
| D | `assessment_month_year` | `YYYY-MM` |
| E | `status` | Planned · In Progress · Completed · On Hold · Cancelled |
| F | `lead_reviewer` | |
| G | `reviewer_region` | NA · LATAM · EMEA · APAC |
| H | `tp_locations` | comma-separated |
| I | `headcount` | integer |
| J | `notes` | free text |
| K | `created_at` | ISO timestamp |
| L | `updated_at` | ISO timestamp |

### LinesOfBusiness sheet — one row per LOB per third party

| # | Field | |
|---|---|---|
| A | `lob_id` | `LOB-0001` auto-generated |
| B | `tp_id` | FK → ThirdParties |
| C | `line_of_business` | |
| D | `service_description` | |
| E | `vendor_manager` | |

### Config sheet — key/value dropdowns (`config_key`, `config_value`)

## Hard Rules

**Sheets access**
- Always `SpreadsheetApp.openById(id)` — never `getActiveSpreadsheet()` (breaks in web app context).
- `SPREADSHEET_ID` lives in `PropertiesService.getScriptProperties()`, never hardcoded.
- All reads/writes use `getRange().getValues()` / `setValues()` — never row-by-row loops (quota).

**Locking — avoid deadlock**
- Public functions that write acquire `LockService.getScriptLock()`.
- Internal helpers (`_saveTP`, `_saveLob`, `_deleteLob`, etc.) have no lock — they are only called from within an already-locked public function.
- Batched operations (`saveThirdPartyWithLobs`, `deleteThirdPartyWithLobs`) take one lock for the entire transaction.

**Server functions**
- Must be top-level in `.gs` — no classes, no modules.
- Always return `{ success: true, data: ... }` or `{ success: false, error: message }`. Never throw — client-side GAS swallows unhandled exceptions silently.

**Frontend**
- All server calls: `google.script.run.withSuccessHandler(fn).withFailureHandler(fn).fnName(args)`.
- No CDN or external resources — GAS sandbox blocks cross-origin fetches from HTML; route external calls through `UrlFetchApp` in `.gs`.
- CSS in `Stylesheet.html`, JS in `JavaScript.html`, included in `Index.html` via `<?!= include('Filename') ?>`.

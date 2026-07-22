# TPRM Assessment Planning Tool

**Stack:** Google Apps Script (backend + frontend via `HtmlService`) · Google Sheets (database)  
**Pattern:** Browser → `google.script.run` → `.gs` functions → Sheets. No REST API.

## Purpose & Domain Context

This tool helps **leadership coordinate a large, hard-to-maintain third party universe**. Think of it less as an assessment tracker and more as a **lead list**: reviewers work through a roster of vendors whose accuracy is constantly in question — records go stale, contracts lapse, business activity disappears without formal notice.

A key workflow is the **discovery phase**: before scheduling an assessment, a consultant confirms whether a real, active business relationship still exists. If the investigation finds no current activity (contract recently expired, engagement dormant for several months, no active service delivery), the third party is not removed — it stays in the universe as a permanent record — but it is flagged so the team knows an assessment is **not applicable** for this cycle.

## File Structure

```
appsscript.json     # Manifest, OAuth scopes, webapp config
Code.gs             # doGet(), include(), getInitialData()
DB.gs               # getSpreadsheet(), getSheet(), generateId(), rowToObject(), objectToRow()
Config.gs           # Sheet/header constants, initializeSheets(), getConfigValues()
ThirdParties.gs     # TP CRUD + saveThirdPartyWithLobs(), deleteThirdPartyWithLobs()
LinesOfBusiness.gs  # LOB CRUD (_saveLob, _deleteLob, getLobsByTpId, _deleteLobsByTpId)
Index.html          # Shell page — inlines Stylesheet.html and JavaScript.html via include()
Stylesheet.html     # <style> block only
JavaScript.html     # <script> block only
```

## Data Model

### ThirdParties sheet — column order is the source of truth for `objectToRow()`

| # | Field | Values |
|---|---|---|
| A | `tp_id` | `TP-0001` auto-generated |
| B | `name` | |
| C | `alternate_name` | |
| D | `assessment_month_year` | `YYYY-MM` |
| E | `status` | Planned · In Progress · Completed · On Hold · Cancelled · **Not Applicable** |
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

**Status semantics:**

| Status | Meaning |
|---|---|
| Planned | Assessment confirmed for the scheduled month |
| In Progress | Assessment execution has started |
| Completed | Assessment delivered and closed |
| On Hold | Temporarily paused — relationship still active |
| Cancelled | Will not happen this cycle — relationship still active |
| **Not Applicable** | Discovery found no active business relationship (expired contract or dormant engagement); excluded from this cycle but record is retained |

## UX Intent

Two views, one record panel:

- **Program view** — 12-month grid for the selected year; primary orientation for leadership. Each month cell lists the third parties scheduled in it. `Not Applicable` records are shown but muted so they don't pollute workload signals. Month-level counts and any headcount/workload summaries exclude `Not Applicable`.
- **Roster view** — full list of all third parties, filterable by status and region. This is where reviewers scan and manage the universe. `Not Applicable` records are always included — hiding them would defeat the purpose of maintaining the universe.
- **Record panel** — opens from either view; covers all TP fields plus an inline LOB table for managing lines of business. When status is `Not Applicable`, the `notes` field should be the most prominent editable element — it is the discovery log and the only place to capture why the record was flagged (contract end date, last activity, etc.).

## Hard Rules

**Sheets access**
- Always `SpreadsheetApp.openById(id)` — never `getActiveSpreadsheet()` (breaks in web app context).
- `SPREADSHEET_ID` lives in `PropertiesService.getScriptProperties()`, never hardcoded.
- All reads/writes use `getRange().getValues()` / `setValues()` — never row-by-row loops (quota).

**Locking — avoid deadlock**
- Public functions that write acquire `LockService.getScriptLock()`.
- Internal helpers (`_saveTP`, `_saveLob`, `_deleteLob`, etc.) have no lock — called only from within an already-locked public function.
- Batched operations (`saveThirdPartyWithLobs`, `deleteThirdPartyWithLobs`) take one lock for the entire transaction.

**Server functions**
- Must be top-level in `.gs` — no classes, no modules.
- Always return `{ success: true, data: ... }` or `{ success: false, error: message }`. Never throw — GAS swallows unhandled client-side exceptions silently.
- All client calls: `google.script.run.withSuccessHandler(fn).withFailureHandler(fn).fnName(args)`.
- No CDN or external resources in HTML — GAS sandbox blocks cross-origin fetches; use `UrlFetchApp` in `.gs` for any external calls.

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
| M | `business_owner` | Internal relationship owner / business unit sponsor (email or display name) |
| N | `assessment_type` | Questionnaire · Document Review · On-Site Audit · Continuous Monitoring |
| O | `applicable_frameworks` | comma-separated (SOX · HIPAA · PCI DSS · GDPR · DORA · ISO 27001 · SIG · VSAQ · etc.) |

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

### Roles

| Role | Access |
|---|---|
| **Manager** | All modules including User Management. Multiple managers are allowed — there is no single owner. |
| **Reviewer** | Program view, Roster, and individual record editing. No access to User Management or user administration. |

### Modules

**Executive Summary**
High-level read-only dashboard oriented toward leadership. Surfaces KPI cards and chart artifacts: total universe size, assessments scheduled vs. completed for the current year, `Not Applicable` count, coverage gaps, and regulatory framework coverage (count of vendors tagged per framework, derived from `applicable_frameworks`). Managers and Reviewers can view; only the data layer drives it — no manual input.

**Analytics**
Dedicated data visualization section with the following breakouts, each rendered as a chart artifact:
- **By Region** — assessment distribution across reviewer regions (NA · LATAM · EMEA · APAC)
- **By Quarter** — Q1/Q2/Q3/Q4 volume and completion rate for the selected year
- **By Month** — month-by-month scheduled vs. completed assessments for the selected year
- **By Status** — distribution across all status values; `Not Applicable` is always shown as its own segment, never folded into other categories, so leadership can track universe hygiene over time

All Analytics charts exclude `Not Applicable` from workload metrics (headcount, completion rate) but include them in universe-size and trend counts.

**Program View**
12-month grid for the selected year — primary planning surface for leadership. Each month cell lists scheduled third parties. `Not Applicable` records appear muted and do not count toward monthly totals or headcount signals.

**Roster**
Full third party list, filterable by status, region, business owner, and applicable frameworks. The operational surface for reviewers managing the universe. `Not Applicable` records are always visible — hiding them would undermine universe accuracy.

**Record Panel**
Opens from Program View or Roster. Covers all TP fields plus the inline LOB table. Key fields:
- `business_owner` — displayed prominently alongside `lead_reviewer`; represents the internal sponsor accountable for the relationship, distinct from the assessor.
- `assessment_type` — dropdown (Questionnaire · Document Review · On-Site Audit · Continuous Monitoring); drives scope and effort expectations for the assessment cycle.
- `applicable_frameworks` — multi-select or comma-separated tag input; captures which regulatory or assessment frameworks govern this vendor (SOX, HIPAA, PCI DSS, GDPR, DORA, ISO 27001, SIG, VSAQ, etc.); used for coverage mapping in Executive Summary.

When status is `Not Applicable`, the `notes` field is the most prominent editable element — it serves as the discovery log (contract end date, last known activity, finding rationale).

**User Management**
Manager-only. Manages the list of app users and their role assignments (Manager / Reviewer). Minimum viable: add user by email, assign role, remove access.

## Hard Rules

**Authentication**
- Identity is resolved server-side via `Session.getActiveUser().getEmail()` — never trust anything passed from the client.
- On every request that requires a role check, call this first, look up the email in the Users sheet, and return `{ success: false, error: 'Unauthorized' }` before doing any work if the role is insufficient.
- User Management writes (add/remove/reassign) must also verify the caller is a Manager before executing.

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

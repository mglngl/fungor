/**
 * Config.gs — sheet names, header constants, one-time setup, dropdown values.
 *
 * Column order in the *_HEADERS arrays is the source of truth for objectToRow()/rowToObject().
 * Do not reorder columns in the live sheets without changing these arrays.
 */

/** Script Property that stores the database spreadsheet id (never hardcode it). */
var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';

var SHEET_NAMES = {
  TPS: 'ThirdParties',
  LOBS: 'LinesOfBusiness',
  CONFIG: 'Config',
  USERS: 'Users'
};

var TP_HEADERS = [
  'tp_id', 'name', 'alternate_name', 'assessment_month_year', 'status',
  'lead_reviewer', 'regions', 'tp_locations', 'headcount', 'notes',
  'created_at', 'updated_at', 'business_owner', 'assessment_type', 'applicable_frameworks',
  // added in v6 — appended (never inserted) so existing rows keep their column positions
  'vra_number', 'completed_date', 'region_lead', 'supplier_type', 'infosec_version'
];

var LOB_HEADERS = ['lob_id', 'tp_id', 'line_of_business', 'service_description', 'vendor_manager'];

var USER_HEADERS = ['email', 'first_name', 'last_name', 'role', 'added_at'];

var CONFIG_HEADERS = ['config_key', 'config_value'];

/** Header names renamed in later versions: initializeSheets() rewrites the old name in place (same column, same data). */
var HEADER_RENAMES = { ThirdParties: { reviewer_region: 'regions' } };

/** Config keys renamed in later versions (old -> new). */
var CONFIG_KEY_RENAMES = { reviewer_region: 'region' };

/** Columns that hold real numbers; every other column is stored as plain text ('@'). */
var NUMERIC_COLUMNS = { ThirdParties: ['headcount'] };

/**
 * Default dropdown values. initializeSheets() adds any value listed here that the Config sheet does not have yet,
 * so to retire an option remove it from BOTH this list and the Config sheet.
 */
var DEFAULT_CONFIG = {
  status: ['Planned', 'In Progress', 'Completed', 'On Hold', 'Cancelled', 'Not Applicable'],
  region: ['NA', 'LATAM', 'EMEA', 'APAC', 'US'],
  assessment_type: ['Questionnaire', 'Document Review', 'On-Site Audit', 'Continuous Monitoring'],
  framework: ['SOX', 'HIPAA', 'PCI DSS', 'GDPR', 'DORA', 'ISO 27001', 'SIG', 'VSAQ', 'SOC 2', 'NIST CSF'],
  role: ['Manager', 'Reviewer'],
  supplier_type: ['Tier 1', 'TPD', 'SaaS', 'Logistics', 'Tier 2', 'Review', 'Tier 1 OR', 'VIS', 'TF Project', 'Frontier'],
  infosec_version: ['4.1', '4.2']
};

/** Header row for a sheet name. */
function headersFor_(sheetName) {
  switch (sheetName) {
    case SHEET_NAMES.TPS: return TP_HEADERS;
    case SHEET_NAMES.LOBS: return LOB_HEADERS;
    case SHEET_NAMES.USERS: return USER_HEADERS;
    case SHEET_NAMES.CONFIG: return CONFIG_HEADERS;
    default: throw new Error('Unknown sheet: ' + sheetName);
  }
}

/**
 * Dropdown values from the Config sheet, falling back to DEFAULT_CONFIG per key.
 * Internal (no auth) — public callers must authorize first.
 * @return {Object<string, string[]>}
 */
function readConfig_() {
  var rows = readAll_(SHEET_NAMES.CONFIG);
  var out = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (k) { out[k] = []; });
  rows.forEach(function (r) {
    var k = String(r.config_key).trim();
    var v = String(r.config_value).trim();
    if (out[k] && v) out[k].push(v);
  });
  Object.keys(DEFAULT_CONFIG).forEach(function (k) {
    if (!out[k].length) out[k] = DEFAULT_CONFIG[k].slice();
  });
  return out;
}

/** Public: dropdown values for any signed-in user. */
function getConfigValues() {
  try {
    var auth = authorize_(['Manager', 'Reviewer']);
    if (!auth.success) return auth;
    return ok_(readConfig_());
  } catch (err) {
    return fail_(err);
  }
}

/**
 * ONE-TIME SETUP (run from the Apps Script editor).
 * Creates a new Google Sheet to act as the database, stores its id in Script Properties,
 * then runs initializeSheets(). If SPREADSHEET_ID is already set it only runs initializeSheets().
 * To use an existing spreadsheet instead, add the SPREADSHEET_ID script property by hand
 * (Project Settings → Script properties) and run initializeSheets().
 */
function setupDatabase() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty(PROP_SPREADSHEET_ID)) {
      if (!isOwnerRun_()) return fail_('Unauthorized');
      var ss = SpreadsheetApp.create('TPRM Assessment Planner — Database');
      props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
    }
    return initializeSheets();
  } catch (err) {
    return fail_(err);
  }
}

/**
 * Idempotent. Creates any missing sheet with its header row, appends header columns added in later versions,
 * adds missing Config defaults and — only when the
 * Users sheet is empty — registers the deploying account as the first Manager.
 * Never deletes or rewrites existing data.
 *
 * Authorization: a Manager, or (bootstrap, no Manager exists yet) the account running the script from the editor.
 */
function initializeSheets() {
  try {
    var bootstrap = false;
    var hasManager = false;
    var ssExists = !!PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
    if (ssExists && getSpreadsheet().getSheetByName(SHEET_NAMES.USERS)) {
      hasManager = readAll_(SHEET_NAMES.USERS).some(function (u) { return u.role === 'Manager'; });
    }
    if (hasManager) {
      var auth = authorize_(['Manager']);
      if (!auth.success) return auth;
    } else {
      if (!isOwnerRun_()) return fail_('Unauthorized');
      bootstrap = true;
    }

    return withScriptLock_(function () {
      var ss = getSpreadsheet();
      var created = [];
      Object.keys(SHEET_NAMES).forEach(function (key) {
        var name = SHEET_NAMES[key];
        if (ensureSheet_(ss, name, headersFor_(name))) created.push(name);
      });

      // Drop the default empty "Sheet1" that a brand-new spreadsheet ships with.
      var blank = ss.getSheetByName('Sheet1');
      if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

      // Config keys renamed in later versions (values and order are kept).
      var cfgExisting = readAll_(SHEET_NAMES.CONFIG);
      if (cfgExisting.some(function (r) { return CONFIG_KEY_RENAMES[String(r.config_key).trim()]; })) {
        writeAll_(SHEET_NAMES.CONFIG, cfgExisting.map(function (r) {
          var k = String(r.config_key).trim();
          return { config_key: CONFIG_KEY_RENAMES[k] || k, config_value: r.config_value };
        }));
      }

      // Config defaults: add any default value the sheet does not have yet (existing rows are never touched).
      var haveCfg = {};
      readAll_(SHEET_NAMES.CONFIG).forEach(function (r) {
        haveCfg[String(r.config_key).trim() + '\u0000' + String(r.config_value).trim()] = true;
      });
      var cfgRows = [];
      Object.keys(DEFAULT_CONFIG).forEach(function (k) {
        DEFAULT_CONFIG[k].forEach(function (v) {
          if (!haveCfg[k + '\u0000' + v]) cfgRows.push({ config_key: k, config_value: v });
        });
      });
      if (cfgRows.length) appendRows_(SHEET_NAMES.CONFIG, cfgRows);

      // First Manager.
      var owner = '';
      if (readAll_(SHEET_NAMES.USERS).length === 0) {
        owner = Session.getEffectiveUser().getEmail().toLowerCase();
        var nm = nameFromEmail_(owner);
        writeAll_(SHEET_NAMES.USERS, [{
          email: owner, first_name: nm.first, last_name: nm.last, role: 'Manager', added_at: todayIso_()
        }]);
      }

      // Sharing + admin-sheet protections follow the Users sheet.
      syncAccess_();
      return ok_({ createdSheets: created, firstManager: owner, bootstrap: bootstrap, spreadsheetId: ss.getId(), url: ss.getUrl() });
    });
  } catch (err) {
    return fail_(err);
  }
}

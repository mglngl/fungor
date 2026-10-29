/**
 * DB.gs — thin data-access layer over Google Sheets.
 *
 * Rules enforced here:
 *  - Always SpreadsheetApp.openById(id) — never getActiveSpreadsheet() (breaks in a web-app context).
 *  - SPREADSHEET_ID comes from Script Properties.
 *  - Reads/writes are whole-range getValues()/setValues() — never row-by-row loops (quota).
 *  - Functions whose name ends in "_" are private to the server: google.script.run cannot call them.
 */

var SS_CACHE_ = null; // per-execution cache (each google.script.run call is a fresh execution)

/** @return {string} the database spreadsheet id (throws a readable error if setup has not been run). */
function getSpreadsheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) {
    throw new Error('SPREADSHEET_ID is not set. Run setupDatabase() from the editor, or add the SPREADSHEET_ID script property.');
  }
  return id;
}

/** @return {GoogleAppsScript.Spreadsheet.Spreadsheet} */
function getSpreadsheet() {
  if (!SS_CACHE_) SS_CACHE_ = SpreadsheetApp.openById(getSpreadsheetId_());
  return SS_CACHE_;
}

/** @return {GoogleAppsScript.Spreadsheet.Sheet} the named sheet; throws if it does not exist. */
function getSheet(name) {
  var sh = getSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" not found. Run initializeSheets() from the editor.');
  return sh;
}

/**
 * Next sequential id for a prefix, e.g. generateId('TP', ids) -> 'TP-0032'.
 * @param {string} prefix  'TP' | 'LOB'
 * @param {string[]} existingIds  ids already in use (including any generated earlier in the same batch)
 */
function generateId(prefix, existingIds) {
  var max = 0;
  (existingIds || []).forEach(function (id) {
    var m = /(\d+)$/.exec(String(id));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return prefix + '-' + n;
}

/** Sheet row (array) -> object, using the header array as keys. */
function rowToObject(headers, row) {
  var o = {};
  for (var i = 0; i < headers.length; i++) o[headers[i]] = row[i] === undefined ? '' : row[i];
  return o;
}

/** Object -> sheet row (array) in header order. Missing fields become ''. */
function objectToRow(headers, obj) {
  return headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
}

/** Normalizes a raw cell: Dates -> ISO text (month column -> yyyy-MM), numbers kept only in numeric columns. */
function normalizeCell_(sheetName, header, value) {
  var numeric = (NUMERIC_COLUMNS[sheetName] || []).indexOf(header) >= 0;
  if (numeric) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(n) ? n : 0;
  }
  if (value instanceof Date) {
    if (header === 'assessment_month_year') return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM');
    if (header === 'added_at' || header === 'completed_date') return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return value.toISOString();
  }
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Reads every data row of a sheet in ONE getValues() call.
 * @return {Object[]} objects keyed by header; rows whose first cell is blank are skipped.
 */
function readAll_(sheetName) {
  var headers = headersFor_(sheetName);
  var sh = getSheet(sheetName);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0]).trim() === '') continue;
    var o = {};
    for (var c = 0; c < headers.length; c++) o[headers[c]] = normalizeCell_(sheetName, headers[c], values[r][c]);
    out.push(o);
  }
  return out;
}

/**
 * Replaces ALL data rows of a sheet with `objects` using one clearContent() + one setValues().
 * Text formats are applied BEFORE writing so "2026-01" stays text instead of becoming a date.
 * Only call from inside a locked public function.
 */
function writeAll_(sheetName, objects) {
  var headers = headersFor_(sheetName);
  var sh = getSheet(sheetName);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (!objects.length) return;

  var needRows = objects.length + 1;
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());

  applyColumnFormats_(sh, sheetName, headers, 2, objects.length);
  var matrix = objects.map(function (o) { return objectToRow(headers, o); });
  sh.getRange(2, 1, objects.length, headers.length).setValues(matrix);
}

/** Appends rows to the end of a sheet with one setValues(). Only call from inside a locked public function. */
function appendRows_(sheetName, objects) {
  if (!objects.length) return;
  var headers = headersFor_(sheetName);
  var sh = getSheet(sheetName);
  var start = Math.max(sh.getLastRow(), 1) + 1;
  var needRows = start + objects.length - 1;
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  applyColumnFormats_(sh, sheetName, headers, start, objects.length);
  sh.getRange(start, 1, objects.length, headers.length)
    .setValues(objects.map(function (o) { return objectToRow(headers, o); }));
}

/** Text ('@') for every column except the numeric ones — prevents Sheets from coercing values or evaluating formulas. */
function applyColumnFormats_(sh, sheetName, headers, startRow, numRows) {
  var numeric = NUMERIC_COLUMNS[sheetName] || [];
  sh.getRange(startRow, 1, numRows, headers.length).setNumberFormat('@');
  numeric.forEach(function (h) {
    var col = headers.indexOf(h) + 1;
    if (col > 0) sh.getRange(startRow, col, numRows, 1).setNumberFormat('0');
  });
}

/**
 * Creates the sheet (with a styled, frozen header row) when missing.
 * If it exists, verifies the header row matches instead of silently shifting columns. Columns added to the end of a
 * *_HEADERS array in a later version are appended to the right of the existing ones (existing data never moves).
 * @return {boolean} true when the sheet was created.
 */
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) {
    sh = ss.insertSheet(name);
    created = true;
  }
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  var existing = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, headers.length).getValues()[0] : [];
  var blankHeader = existing.every(function (c) { return String(c).trim() === ''; });
  if (blankHeader) {
    sh.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers])
      .setFontWeight('bold').setBackground('#f4f4f5');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, headers.length, 150);
    // Pre-format the empty body as text so manual edits behave like the app's writes.
    var rows = Math.max(sh.getMaxRows() - 1, 1);
    applyColumnFormats_(sh, name, headers, 2, rows);
  } else {
    var appendFrom = -1; // first trailing column whose header is still blank
    var renames = (typeof HEADER_RENAMES !== 'undefined' && HEADER_RENAMES[name]) || {};
    for (var i = 0; i < headers.length; i++) {
      var found = String(existing[i]).trim();
      if (renames[found] === headers[i]) { sh.getRange(1, i + 1).setValue(headers[i]); found = headers[i]; } // renamed column
      if (appendFrom < 0 && found === '') appendFrom = i;
      var ok = appendFrom >= 0 ? found === '' : found === headers[i];
      if (!ok) {
        throw new Error('Sheet "' + name + '" has an unexpected header in column ' + (i + 1) +
          ' (found "' + existing[i] + '", expected "' + headers[i] + '"). Fix the header row or rename the sheet.');
      }
    }
    if (appendFrom >= 0) {
      var added = headers.slice(appendFrom);
      sh.getRange(1, appendFrom + 1, 1, added.length).setNumberFormat('@').setValues([added])
        .setFontWeight('bold').setBackground('#f4f4f5');
      sh.setColumnWidths(appendFrom + 1, added.length, 150);
      var bodyRows = Math.max(sh.getMaxRows() - 1, 1);
      sh.getRange(2, appendFrom + 1, bodyRows, added.length).setNumberFormat('@'); // new columns hold text only
    }
  }
  return created;
}

/**
 * Runs `fn` under the script lock and returns its result ({success,...}).
 * Public functions that write call this once for the whole transaction; internal helpers never lock.
 */
function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return fail_('The system is busy — please try again in a moment.');
  try {
    return fn();
  } catch (err) {
    return fail_(err);
  } finally {
    lock.releaseLock();
  }
}

/** Standard success envelope. */
function ok_(data) {
  return { success: true, data: data };
}

/** Standard failure envelope. Accepts a string or an Error; logs real exceptions. */
function fail_(err) {
  var message = err && err.message ? err.message : String(err);
  if (err && err.stack) console.error(err.stack);
  return { success: false, error: message };
}

/** yyyy-MM-dd in the script time zone. */
function todayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

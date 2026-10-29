/**
 * Code.gs — web-app entry points.
 *
 *   Browser → google.script.run → top-level .gs functions → Google Sheets.   (No REST API.)
 *
 * Every server function returns { success: true, data } or { success: false, error } and never throws.
 */

var APP_TITLE = 'TPRM Assessment Planner';

/** Serves the single-page UI. */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** The only HTML files include() will return. Every other file (e.g. README) stays server-side. */
var INCLUDABLE_FILES_ = ['Fonts', 'Stylesheet', 'JavaScript'];

/**
 * Inlines another HTML file of this project (used from Index.html as <?!= include('Stylesheet') ?>).
 * Public (google.script.run can call it), so it only serves the allow-listed page parts above.
 * @param {string} filename without the .html extension
 */
function include(filename) {
  var name = String(filename || '');
  if (INCLUDABLE_FILES_.indexOf(name) < 0) throw new Error('Not available.');
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * One call that boots the whole UI (and refreshes it later): identity, dropdown values, third parties, LOBs and —
 * for Managers only — the user list.
 * @return {{success:true, data:Object}|{success:false, error:string}}
 */
function getInitialData() {
  try {
    var auth = authorize_(['Manager', 'Reviewer']);
    if (!auth.success) return auth;
    var me = auth.data;

    var data = {
      me: me,
      config: readConfig_(),
      tps: readAll_(SHEET_NAMES.TPS),
      lobs: readAll_(SHEET_NAMES.LOBS),
      users: [],
      // Read from Script Properties on every call, so editing SPREADSHEET_ID shows up on the next load/refresh.
      spreadsheetId: getSpreadsheetId_(),
      serverTime: new Date().toISOString()
    };
    if (me.role === 'Manager') {
      data.users = usersForClient_();
    }
    return ok_(data);
  } catch (err) {
    return fail_(err);
  }
}

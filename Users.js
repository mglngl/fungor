/**
 * Users.gs — identity, role checks and User Management (Manager only).
 *
 * Identity is ALWAYS resolved server-side with Session.getActiveUser().getEmail().
 * Nothing about "who the caller is" or "what role they have" is ever read from the client.
 *
 * The Users sheet is the single source of truth for access. syncAccess_() makes the spreadsheet's sharing and the
 * admin-sheet protections match it after every user change. Two deployment models (see README.html, section 4):
 *   - Execute as the user accessing (required on personal Google accounts, which hide visitor e-mails otherwise):
 *     every user needs edit access to the spreadsheet, so sharing stays ON (the default).
 *   - Execute as the owner (Workspace domain): set Script Property SHARE_DATABASE_WITH_USERS = false and the
 *     spreadsheet stays private; only the sheet protections are managed.
 * Works with the database in My Drive or in a shared drive (where Google reports no owner).
 */

var EMAIL_RE_ = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

var IDENTITY_UNAVAILABLE_ = 'Google did not share your account email with this app, so your access cannot be checked. ' +
  'Open the link while signed in to the Google account a Manager added, and allow the permissions it asks for.';

/** @return {string} lower-cased e-mail of the caller ('' when Google does not disclose it). */
function getCurrentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

/**
 * True when the caller owns the database spreadsheet (or, before it exists, is the account running the script).
 * Used only for first-run bootstrap (no Manager exists yet). The web app may run as the visitor, so the effective user
 * cannot be used to recognise the owner once the spreadsheet exists. A spreadsheet in a shared drive has no owner,
 * so bootstrap is refused there: create the database in My Drive (setupDatabase does), then move it.
 */
function isOwnerRun_() {
  var active = getCurrentEmail_();
  if (!active) return false;
  if (PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID)) {
    return active === spreadsheetOwnerEmail_(getSpreadsheet());
  }
  var owner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  return active === owner;
}

/** Lower-cased e-mail of the spreadsheet owner ('' if unknown). */
function spreadsheetOwnerEmail_(ss) {
  var owner = ss.getOwner();
  return owner ? String(owner.getEmail() || '').trim().toLowerCase() : '';
}

/** True when an error means "this account cannot open the database spreadsheet". */
function isAccessDenied_(err) {
  return /permission|not have access|access denied/i.test(String(err && err.message ? err.message : err));
}

/**
 * Role gate. Call FIRST in every public function, before doing any work.
 * @param {string[]} allowedRoles e.g. ['Manager'] or ['Manager', 'Reviewer']
 * @return {{success:true, data:Object}|{success:false, error:string}}
 *   data = { email, first, last, full, initials, role, added }
 */
function authorize_(allowedRoles) {
  var email;
  try {
    email = getCurrentEmail_();
    if (!email) return { success: false, error: IDENTITY_UNAVAILABLE_ };
    var users;
    try {
      users = readAll_(SHEET_NAMES.USERS);
    } catch (readErr) {
      // Not shared with this account = not in User Management.
      if (isAccessDenied_(readErr)) return { success: false, error: 'Unauthorized' };
      throw readErr;
    }
    var user = users.filter(function (u) { return u.email.toLowerCase() === email; })[0];
    if (!user || allowedRoles.indexOf(user.role) < 0) return { success: false, error: 'Unauthorized' };
    return { success: true, data: userToClient_(user) };
  } catch (err) {
    // Configuration problems (missing id / sheet) surface as a readable error instead of a false "Unauthorized".
    return fail_(err);
  }
}

/** "jane.doe@x.com" -> {first:'Jane', last:'Doe'} */
function nameFromEmail_(email) {
  var local = String(email).split('@')[0];
  var parts = local.split(/[._-]+/);
  var cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };
  return { first: cap(parts[0] || ''), last: cap(parts[1] || '') };
}

/** Sheet user row -> shape the UI uses. */
function userToClient_(u) {
  var fallback = nameFromEmail_(u.email);
  var first = String(u.first_name || '').trim() || fallback.first;
  var last = String(u.last_name || '').trim() || fallback.last;
  return {
    email: u.email,
    first: first,
    last: last,
    full: (first + ' ' + last).trim(),
    initials: ((first.charAt(0) || '') + (last.charAt(0) || '')).toUpperCase(),
    role: u.role,
    added: u.added_at
  };
}

function usersForClient_() {
  return readAll_(SHEET_NAMES.USERS)
    .map(userToClient_)
    .sort(function (a, b) { return a.added < b.added ? -1 : a.added > b.added ? 1 : a.email < b.email ? -1 : 1; });
}

/** Validates + normalizes a user form. Returns {error} or {value}. */
function validateUserInput_(input, roles) {
  input = input || {};
  var first = String(input.first || '').trim();
  var last = String(input.last || '').trim();
  var email = String(input.email || '').trim().toLowerCase();
  var role = String(input.role || '').trim();
  if (!first || !last) return { error: 'First and last name are required.' };
  if (first.length > 100 || last.length > 100) return { error: 'Names are limited to 100 characters.' };
  if (!EMAIL_RE_.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
  if (roles.indexOf(role) < 0) return { error: 'Invalid role.' };
  return { value: { first: first, last: last, email: email, role: role } };
}

function countManagers_(rows) {
  return rows.filter(function (u) { return u.role === 'Manager'; }).length;
}

function userRow_(v, added) {
  return { email: v.email, first_name: v.first, last_name: v.last, role: v.role, added_at: added };
}

/** Script Property switch: set to "false" when the web app executes as its owner (Model A in README.html). */
var PROP_SHARE_WITH_USERS = 'SHARE_DATABASE_WITH_USERS';
/** Script Property the app maintains itself: JSON list of accounts it shared the spreadsheet with. Do not edit. */
var PROP_APP_SHARED = 'APP_SHARED_EDITORS';

/** True unless SHARE_DATABASE_WITH_USERS is "false". Default (property absent) keeps sharing on. */
function isSharingEnabled_() {
  var v = PropertiesService.getScriptProperties().getProperty(PROP_SHARE_WITH_USERS);
  return String(v == null ? 'true' : v).trim().toLowerCase() !== 'false';
}

function readAppShared_() {
  try {
    var list = JSON.parse(PropertiesService.getScriptProperties().getProperty(PROP_APP_SHARED) || '[]');
    return Array.isArray(list) ? list.map(function (e) { return String(e).trim().toLowerCase(); }).filter(String) : [];
  } catch (e) {
    return [];
  }
}

function writeAppShared_(list) {
  var unique = list.filter(function (e, i) { return e && list.indexOf(e) === i; }).sort();
  PropertiesService.getScriptProperties().setProperty(PROP_APP_SHARED, JSON.stringify(unique));
}

/**
 * Shares the database with one account before it is added to the Users sheet, so a bad address fails cleanly
 * and nothing is written. No-op when sharing is switched off. Only call from inside a locked public function.
 */
function shareDatabaseWith_(email) {
  if (!isSharingEnabled_()) return;
  try {
    getSpreadsheet().addEditor(email);
  } catch (err) {
    throw new Error('Could not give ' + email + ' access to the database. It must be a Google account (' +
      (err && err.message ? err.message : err) + ').');
  }
}

/**
 * Makes the database match the Users sheet (the single source of truth):
 *   1. sharing ON: every user is an editor of the spreadsheet;
 *   2. always: the Users and Config sheets are protected so only Managers (and the owner) can edit them directly;
 *   3. sharing ON: access is revoked from accounts that are no longer users. In My Drive that means every editor or
 *      viewer not in the Users sheet (the owner is never touched). In a shared drive (no owner) only accounts the
 *      app itself shared with are revoked — access inherited from the shared drive is left to its managers.
 *      sharing OFF: every share the app made earlier is revoked, so the spreadsheet is reachable only through the app.
 * Problems are collected and reported together, after everything that could be done was done.
 * Only call from inside a locked public function, after the Users sheet has been written.
 */
function syncAccess_() {
  var ss = getSpreadsheet();
  var owner = spreadsheetOwnerEmail_(ss);
  var inSharedDrive = !owner;
  var me = getCurrentEmail_();
  var sharing = isSharingEnabled_();
  var problems = [];
  var msg = function (err) { return err && err.message ? err.message : String(err); };
  var emailsOf = function (list) {
    return list.map(function (u) { return String(u.getEmail() || '').trim().toLowerCase(); }).filter(String);
  };

  var everyone = {};
  var managers = {};
  readAll_(SHEET_NAMES.USERS).forEach(function (u) {
    var e = String(u.email || '').trim().toLowerCase();
    if (!e) return;
    everyone[e] = true;
    if (u.role === 'Manager') managers[e] = true;
  });
  var tracked = readAppShared_();

  // 1) share with every listed user
  if (sharing) {
    var editorsNow = emailsOf(ss.getEditors());
    Object.keys(everyone).forEach(function (e) {
      if (e === owner) return;
      try {
        if (editorsNow.indexOf(e) < 0) ss.addEditor(e);
        if (tracked.indexOf(e) < 0) tracked.push(e);
      } catch (err) {
        problems.push('could not share with ' + e + ' (' + msg(err) + ')');
      }
    });
  }

  // 2) admin sheets: Managers + owner only
  [SHEET_NAMES.USERS, SHEET_NAMES.CONFIG].forEach(function (name) {
    try {
      var sh = getSheet(name);
      var p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || sh.protect();
      p.setDescription('Managed by TPRM Assessment Planner: only Managers can edit this sheet directly.');
      if (p.isWarningOnly()) p.setWarningOnly(false);
      var current = emailsOf(p.getEditors());
      var add = Object.keys(managers).filter(function (e) { return current.indexOf(e) < 0; });
      if (add.length) p.addEditors(add);
      // The owner and the account running this call cannot be removed from a protection.
      current.forEach(function (e) {
        if (e === owner || e === me || managers[e]) return;
        try { p.removeEditor(e); } catch (err) { problems.push('could not remove ' + e + ' from the ' + name + ' protection (' + msg(err) + ')'); }
      });
    } catch (err) {
      problems.push('could not update the ' + name + ' protection (' + msg(err) + ')');
    }
  });

  // 3) revoke access that User Management no longer grants
  var revoke = function (e, asViewer) {
    try {
      if (asViewer) ss.removeViewer(e); else ss.removeEditor(e);
    } catch (err) {
      problems.push('could not remove ' + e + ' from the spreadsheet (' + msg(err) + ')');
    }
  };
  if (sharing) {
    if (inSharedDrive) {
      // only what the app granted; drive-level membership belongs to the shared drive's managers
      tracked.forEach(function (e) { if (!everyone[e]) revoke(e, false); });
    } else {
      emailsOf(ss.getEditors()).forEach(function (e) { if (e !== owner && !everyone[e]) revoke(e, false); });
      emailsOf(ss.getViewers()).forEach(function (e) { if (e !== owner && !everyone[e]) revoke(e, true); });
    }
    tracked = tracked.filter(function (e) { return everyone[e]; });
  } else {
    tracked.forEach(function (e) { if (e !== owner) revoke(e, false); });
    tracked = [];
  }
  writeAppShared_(tracked);

  if (problems.length) throw new Error(problems.join('; '));
}

/** Runs syncAccess_() after a user change; returns a failure envelope (or null when it worked). */
function syncAfterUserChange_() {
  try {
    syncAccess_();
    return null;
  } catch (err) {
    return fail_('The user list was saved, but database sharing could not be fully updated: ' +
      (err && err.message ? err.message : err));
  }
}

/** Manager only: all app users. */
function getUsers() {
  try {
    var auth = authorize_(['Manager']);
    if (!auth.success) return auth;
    return ok_(usersForClient_());
  } catch (err) {
    return fail_(err);
  }
}

/** Manager only: grant access. @param {{first,last,email,role}} input */
function addUser(input) {
  try {
    var auth = authorize_(['Manager']);
    if (!auth.success) return auth;
    return withScriptLock_(function () {
      var cfg = readConfig_();
      var v = validateUserInput_(input, cfg.role);
      if (v.error) return fail_(v.error);
      var rows = readAll_(SHEET_NAMES.USERS);
      if (rows.some(function (u) { return u.email.toLowerCase() === v.value.email; })) return fail_('That user already has access.');
      shareDatabaseWith_(v.value.email);
      rows.push(userRow_(v.value, todayIso_()));
      writeAll_(SHEET_NAMES.USERS, rows);
      var syncErr = syncAfterUserChange_();
      if (syncErr) return syncErr;
      return ok_(usersForClient_());
    });
  } catch (err) {
    return fail_(err);
  }
}

/** Manager only: edit name / e-mail / role. @param {string} originalEmail @param {{first,last,email,role}} input */
function updateUser(originalEmail, input) {
  try {
    var auth = authorize_(['Manager']);
    if (!auth.success) return auth;
    return withScriptLock_(function () {
      var cfg = readConfig_();
      var v = validateUserInput_(input, cfg.role);
      if (v.error) return fail_(v.error);
      var orig = String(originalEmail || '').trim().toLowerCase();
      var rows = readAll_(SHEET_NAMES.USERS);
      var idx = -1;
      rows.forEach(function (u, i) { if (u.email.toLowerCase() === orig) idx = i; });
      if (idx < 0) return fail_('User not found.');
      if (v.value.email !== orig && rows.some(function (u) { return u.email.toLowerCase() === v.value.email; })) {
        return fail_('That email already has access.');
      }
      var demoting = rows[idx].role === 'Manager' && v.value.role !== 'Manager';
      if (demoting && countManagers_(rows) <= 1) return fail_('At least one Manager must remain.');
      if (v.value.email !== orig) shareDatabaseWith_(v.value.email);
      rows[idx] = userRow_(v.value, rows[idx].added_at);
      writeAll_(SHEET_NAMES.USERS, rows);
      var syncErr = syncAfterUserChange_();
      if (syncErr) return syncErr;
      return ok_(usersForClient_());
    });
  } catch (err) {
    return fail_(err);
  }
}

/** Manager only: revoke access. */
function removeUser(email) {
  try {
    var auth = authorize_(['Manager']);
    if (!auth.success) return auth;
    return withScriptLock_(function () {
      var target = String(email || '').trim().toLowerCase();
      var rows = readAll_(SHEET_NAMES.USERS);
      var user = rows.filter(function (u) { return u.email.toLowerCase() === target; })[0];
      if (!user) return fail_('User not found.');
      if (user.role === 'Manager' && countManagers_(rows) <= 1) return fail_('At least one Manager must remain.');
      writeAll_(SHEET_NAMES.USERS, rows.filter(function (u) { return u.email.toLowerCase() !== target; }));
      var syncErr = syncAfterUserChange_();
      if (syncErr) return syncErr;
      return ok_(usersForClient_());
    });
  } catch (err) {
    return fail_(err);
  }
}

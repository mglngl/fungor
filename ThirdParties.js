/**
 * ThirdParties.gs — third party CRUD.
 *
 * Public functions authorize first, then take ONE script lock for the whole transaction.
 * Internal helpers (_saveTP_ …) are lock-free and only called from inside a locked public function.
 *
 * Business rule: a third party is never removed because the relationship ended — it is flagged
 * "Not Applicable" and kept as a permanent record. Hard delete is a Manager-only escape hatch.
 */

var MONTH_RE_ = /^\d{4}-(0[1-9]|1[0-2])$/;
var DATE_RE_ = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
function isIsoDate_(s) {
  var m = DATE_RE_.exec(s);
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Public read: every third party. Any signed-in role. */
function getThirdParties() {
  try {
    var auth = authorize_(['Manager', 'Reviewer']);
    if (!auth.success) return auth;
    return ok_(readAll_(SHEET_NAMES.TPS));
  } catch (err) {
    return fail_(err);
  }
}

/**
 * Create or update a third party together with its lines of business, in one transaction.
 * @param {Object} tp   record fields; empty tp_id means "create". created_at / updated_at are ignored (server-owned).
 * @param {Object[]} lobs  [{lob_id?, line_of_business, service_description, vendor_manager}]
 * @return {{success:true, data:{tp:Object, lobs:Object[]}}|{success:false, error:string}}
 */
function saveThirdPartyWithLobs(tp, lobs) {
  try {
    var auth = authorize_(['Manager', 'Reviewer']);
    if (!auth.success) return auth;
    return withScriptLock_(function () {
      var cfg = readConfig_();
      var nowIso = new Date().toISOString();
      var tps = readAll_(SHEET_NAMES.TPS);
      var saved = _saveTP_(tps, tp, nowIso, cfg);
      if (!saved.success) return saved;

      var allLobs = readAll_(SHEET_NAMES.LOBS);
      var replaced = _replaceLobsForTp_(allLobs, saved.tp.tp_id, lobs);

      writeAll_(SHEET_NAMES.TPS, saved.tps);
      writeAll_(SHEET_NAMES.LOBS, replaced.lobs);
      return ok_({ tp: saved.tp, lobs: replaced.saved });
    });
  } catch (err) {
    return fail_(err);
  }
}

/**
 * Hard-delete a third party and all of its LOBs. Manager only.
 * Prefer status "Not Applicable" for ended relationships — it keeps the record.
 */
function deleteThirdPartyWithLobs(tpId) {
  try {
    var auth = authorize_(['Manager']);
    if (!auth.success) return auth;
    return withScriptLock_(function () {
      var id = String(tpId || '');
      var tps = readAll_(SHEET_NAMES.TPS);
      if (!tps.some(function (t) { return t.tp_id === id; })) return fail_('Third party ' + id + ' was not found.');
      writeAll_(SHEET_NAMES.TPS, tps.filter(function (t) { return t.tp_id !== id; }));
      writeAll_(SHEET_NAMES.LOBS, _deleteLobsByTpId_(readAll_(SHEET_NAMES.LOBS), id));
      return ok_({ tp_id: id });
    });
  } catch (err) {
    return fail_(err);
  }
}

/**
 * Validates + normalizes a third-party form against the Config dropdowns.
 * @return {{error:string}|{value:Object}}  value has every TP field except ids / timestamps.
 */
function validateTp_(input, cfg) {
  input = input || {};
  var str = function (v, max) { return String(v == null ? '' : v).trim().substring(0, max); };
  var canon = function (value, allowed) {
    var hit = allowed.filter(function (a) { return a.toLowerCase() === String(value).trim().toLowerCase(); })[0];
    return hit || null;
  };

  var name = str(input.name, 200);
  if (!name) return { error: 'Name is required.' };

  var month = str(input.assessment_month_year, 7);
  if (month && !MONTH_RE_.test(month)) return { error: 'Assessment month must look like YYYY-MM.' };

  var status = str(input.status, 40) || 'Planned';
  var statusC = canon(status, cfg.status);
  if (!statusC) return { error: 'Invalid status: ' + status + '.' };

  var regions = [];
  var regionTokens = String(input.regions || '').split(/[,;\/]+/);
  for (var i = 0; i < regionTokens.length; i++) {
    var tok = regionTokens[i].trim();
    if (!tok) continue;
    var rc = canon(tok, cfg.region);
    if (!rc) return { error: 'Invalid region: ' + tok + '.' };
    if (regions.indexOf(rc) < 0) regions.push(rc);
  }

  var typeRaw = str(input.assessment_type, 40) || 'Questionnaire';
  var typeC = canon(typeRaw, cfg.assessment_type);
  if (!typeC) return { error: 'Invalid assessment type: ' + typeRaw + '.' };

  var headcountRaw = String(input.headcount == null ? '' : input.headcount).trim();
  var headcount = headcountRaw === '' ? 0 : Number(headcountRaw);
  if (!isFinite(headcount) || headcount < 0 || Math.floor(headcount) !== headcount) {
    return { error: 'Headcount must be a whole number, 0 or greater.' };
  }

  var fws = [];
  String(input.applicable_frameworks || '').split(/[,;]+/).forEach(function (f) {
    f = f.trim().substring(0, 60);
    if (f && fws.indexOf(f) < 0) fws.push(f);
  });

  var completed = str(input.completed_date, 10);
  if (completed && !isIsoDate_(completed)) return { error: 'Completed date must be a real date written as YYYY-MM-DD.' };

  // Optional dropdowns: blank is allowed, anything else must be a Config value.
  var supplierRaw = str(input.supplier_type, 40);
  var supplierC = supplierRaw ? canon(supplierRaw, cfg.supplier_type) : '';
  if (supplierC === null) return { error: 'Invalid supplier type: ' + supplierRaw + '.' };

  var leadRaw = str(input.region_lead, 40);
  var leadC = leadRaw ? canon(leadRaw, cfg.region) : '';
  if (leadC === null) return { error: 'Invalid region lead: ' + leadRaw + '.' };

  var infosecRaw = str(input.infosec_version, 20);
  var infosecC = infosecRaw ? canon(infosecRaw, cfg.infosec_version) : '';
  if (infosecC === null) return { error: 'Invalid InfoSec version: ' + infosecRaw + '.' };

  return {
    value: {
      name: name,
      alternate_name: str(input.alternate_name, 200),
      assessment_month_year: month,
      status: statusC,
      lead_reviewer: str(input.lead_reviewer, 200),
      regions: regions.join(', '),
      tp_locations: str(input.tp_locations, 500),
      headcount: headcount,
      notes: str(input.notes, 20000),
      business_owner: str(input.business_owner, 200),
      assessment_type: typeC,
      applicable_frameworks: fws.join(', '),
      vra_number: str(input.vra_number, 50),
      completed_date: completed,
      region_lead: leadC,
      supplier_type: supplierC,
      infosec_version: infosecC
    }
  };
}

/**
 * Upserts one third party into `tps` (in memory). No lock, no auth — caller has both.
 * @return {{success:true, tps:Object[], tp:Object}|{success:false, error:string}}
 */
function _saveTP_(tps, input, nowIso, cfg) {
  var v = validateTp_(input, cfg);
  if (v.error) return { success: false, error: v.error };

  var id = String((input && input.tp_id) || '').trim();
  var next = tps.slice();
  var rec;
  if (id) {
    var idx = -1;
    next.forEach(function (t, i) { if (t.tp_id === id) idx = i; });
    if (idx < 0) return { success: false, error: 'Third party ' + id + ' no longer exists.' };
    rec = Object.assign({}, next[idx], v.value, { tp_id: id, updated_at: nowIso });
    next[idx] = rec;
  } else {
    id = generateId('TP', next.map(function (t) { return t.tp_id; }));
    rec = Object.assign({}, v.value, { tp_id: id, created_at: nowIso, updated_at: nowIso });
    next.push(rec);
  }
  return { success: true, tps: next, tp: rec };
}

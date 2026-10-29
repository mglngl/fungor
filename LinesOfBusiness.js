/**
 * LinesOfBusiness.gs — LOB rows (one per line of business per third party).
 *
 * Internal helpers (_saveLob_, _deleteLob_, _deleteLobsByTpId_) work on in-memory arrays, take NO lock
 * and are only called from inside an already-locked public function (saveThirdPartyWithLobs /
 * deleteThirdPartyWithLobs). Their names end in "_" so google.script.run cannot call them directly.
 */

var LOB_TEXT_MAX_ = 300;

/** Public read: LOBs of one third party. Any signed-in role. */
function getLobsByTpId(tpId) {
  try {
    var auth = authorize_(['Manager', 'Reviewer']);
    if (!auth.success) return auth;
    var id = String(tpId || '');
    return ok_(readAll_(SHEET_NAMES.LOBS).filter(function (l) { return l.tp_id === id; }));
  } catch (err) {
    return fail_(err);
  }
}

/**
 * Upserts one LOB into `lobs` (in memory).
 * @return {{lobs:Object[], lob:Object}} a new array and the stored LOB.
 */
function _saveLob_(lobs, tpId, input) {
  var clip = function (s) { return String(s == null ? '' : s).trim().substring(0, LOB_TEXT_MAX_); };
  var next = lobs.slice();
  var existingIdx = -1;
  if (input.lob_id) {
    next.forEach(function (l, i) { if (l.lob_id === input.lob_id && l.tp_id === tpId) existingIdx = i; });
  }
  var lob = {
    lob_id: existingIdx >= 0 ? next[existingIdx].lob_id : generateId('LOB', next.map(function (l) { return l.lob_id; })),
    tp_id: tpId,
    line_of_business: clip(input.line_of_business),
    service_description: clip(input.service_description),
    vendor_manager: clip(input.vendor_manager)
  };
  if (existingIdx >= 0) next[existingIdx] = lob; else next.push(lob);
  return { lobs: next, lob: lob };
}

/** Removes one LOB by id (in memory). */
function _deleteLob_(lobs, lobId) {
  return lobs.filter(function (l) { return l.lob_id !== lobId; });
}

/** Removes every LOB of a third party (in memory). */
function _deleteLobsByTpId_(lobs, tpId) {
  return lobs.filter(function (l) { return l.tp_id !== tpId; });
}

/**
 * Makes the stored LOBs of `tpId` equal to `inputs`: blank rows are dropped, rows whose id is no longer sent are
 * deleted, known ids are updated, the rest are created.
 * @return {{lobs:Object[], saved:Object[]}}
 */
function _replaceLobsForTp_(lobs, tpId, inputs) {
  var keep = {};
  var cleaned = (inputs || []).filter(function (l) {
    return String(l.line_of_business || '').trim() || String(l.service_description || '').trim() || String(l.vendor_manager || '').trim();
  });
  cleaned.forEach(function (l) { if (l.lob_id) keep[l.lob_id] = true; });

  var current = lobs;
  lobs.filter(function (l) { return l.tp_id === tpId && !keep[l.lob_id]; })
    .forEach(function (l) { current = _deleteLob_(current, l.lob_id); });

  var saved = [];
  cleaned.forEach(function (l) {
    var r = _saveLob_(current, tpId, l);
    current = r.lobs;
    saved.push(r.lob);
  });
  return { lobs: current, saved: saved };
}

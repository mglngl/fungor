/**
 * Seed.gs — OPTIONAL demo data. Not needed in production; delete this file if you do not want it.
 *
 * seedDemoData() loads the 31 sample third parties and 35 lines of business used in the design prototype so you can
 * compare the live UI against index.html. It only runs against an EMPTY roster and never creates users
 * (the deploying account stays the only Manager).
 *
 * Run from the Apps Script editor after setupDatabase().
 */
function seedDemoData() {
  try {
    var hasManager = readAll_(SHEET_NAMES.USERS).some(function (u) { return u.role === 'Manager'; });
    if (hasManager) {
      var auth = authorize_(['Manager']);
      if (!auth.success) return auth;
    } else if (!isOwnerRun_()) {
      return fail_('Unauthorized');
    }

    return withScriptLock_(function () {
      if (readAll_(SHEET_NAMES.TPS).length > 0) {
        return fail_('The roster already has data — demo data is only loaded into an empty roster.');
      }
      var tps = demoThirdParties_();
      var lobs = demoLobs_();
      writeAll_(SHEET_NAMES.TPS, tps);
      writeAll_(SHEET_NAMES.LOBS, lobs);
      return ok_({ thirdParties: tps.length, linesOfBusiness: lobs.length });
    });
  } catch (err) {
    return fail_(err);
  }
}

function demoThirdParties_() {
  var T = function (id, name, alt, my, status, lead, region, locs, head, owner, type, fw, notes) {
    return {
      tp_id: id, name: name, alternate_name: alt, assessment_month_year: my, status: status, lead_reviewer: lead,
      regions: region, tp_locations: locs, headcount: head, notes: notes || '',
      created_at: '2024-11-04T09:00:00Z', updated_at: '2026-07-10T14:30:00Z',
      business_owner: owner, assessment_type: type, applicable_frameworks: fw
    };
  };
  return [
      T('TP-0001','Meridian Data Services','Meridian DS','2026-01','Completed','Alex Morgan','NA, EMEA','Austin TX, Toronto',420,'Dana Whitfield','Questionnaire','SOX, SOC 2, ISO 27001'),
      T('TP-0002','Novapay Processing','','2026-01','Completed','Priya Nair','NA','Wilmington DE',180,'Erin Cole','On-Site Audit','PCI DSS, SOX'),
      T('TP-0003','Helix Business Services','Helix BPO','2026-02','Completed','Lucía Herrera','LATAM, NA','Mexico City, Bogotá',1450,'Marcus Webb','On-Site Audit','SIG, ISO 27001, GDPR'),
      T('TP-0004','Quartz Legal Partners','','2026-02','Completed','Jonas Weber','EMEA','Frankfurt',95,'Olivia Grant','Document Review','GDPR, DORA'),
      T('TP-0005','Bluepine Analytics','','2026-03','Completed','Mei Tanaka','APAC','Singapore',210,'Sam Patel','Questionnaire','ISO 27001, VSAQ'),
      T('TP-0006','Vantia Security Systems','Vantia','2026-03','Completed','Amara Okafor','EMEA, APAC','London, Nairobi',330,'Tara Singh','Continuous Monitoring','ISO 27001, SIG, NIST CSF'),
      T('TP-0007','Kestrel HR Solutions','','2026-04','Completed','Alex Morgan','NA','Chicago IL',560,'Dana Whitfield','Questionnaire','HIPAA, SOC 2'),
      T('TP-0008','Orbital Telecom Services','OTS','2026-06','In Progress','Diego Ramos','LATAM, NA','São Paulo, Santiago',780,'Marcus Webb','On-Site Audit','SIG, PCI DSS, ISO 27001'),
      T('TP-0009','Tessera IT Staffing','','2026-06','In Progress','Priya Nair','NA','Denver CO',240,'Erin Cole','Document Review','SOC 2, VSAQ'),
      T('TP-0010','Northgate Facilities Group','Northgate FM','2026-07','In Progress','Jonas Weber','EMEA','Rotterdam, Warsaw',1120,'Olivia Grant','On-Site Audit','ISO 27001, SIG'),
      T('TP-0011','Aster Cloud Hosting','','2026-07','In Progress','Arjun Rao','APAC, EMEA','Mumbai, Sydney',610,'Sam Patel','Continuous Monitoring','SOC 2, ISO 27001, DORA'),
      T('TP-0012','Sequoia Print & Mail','','2026-08','Planned','Alex Morgan','NA','Portland OR',150,'Erin Cole','Questionnaire','HIPAA, SOX'),
      T('TP-0013','Marlin Claims Processing','Marlin CP','2026-08','Planned','Lucía Herrera','LATAM','San José CR',430,'Tara Singh','Document Review','HIPAA, SIG'),
      T('TP-0014','Dovetail Payroll','','2026-09','Planned','Priya Nair','NA','Atlanta GA',290,'Dana Whitfield','Questionnaire','SOX, SOC 2'),
      T('TP-0015','Cindral Networks','','2026-09','Planned','Amara Okafor','EMEA','Dublin',205,'Sam Patel','Continuous Monitoring','DORA, ISO 27001, NIST CSF'),
      T('TP-0016','Fernbrook Travel Desk','','2026-10','Planned','Mei Tanaka','APAC, NA','Tokyo, Seoul',88,'Olivia Grant','Questionnaire','VSAQ, GDPR'),
      T('TP-0017','Arqline Facilities','','2026-10','Planned','Diego Ramos','LATAM','Buenos Aires',340,'Marcus Webb','Document Review','SIG'),
      T('TP-0018','Bravura Media Production','','2026-11','Planned','Jonas Weber','EMEA','Amsterdam',60,'Olivia Grant','Questionnaire','GDPR, VSAQ'),
      T('TP-0019','Eastlake Records Management','Eastlake Archives','2026-12','Planned','Alex Morgan','NA','Columbus OH',175,'Erin Cole','On-Site Audit','HIPAA, SOX, ISO 27001'),
      T('TP-0020','Saffron Analytics Lab','','2026-05','On Hold','Arjun Rao','APAC','Bengaluru',130,'Tara Singh','Questionnaire','ISO 27001, VSAQ','Paused pending contract renegotiation — resume after Q3 pricing review.'),
      T('TP-0021','Trellis Facilities Cleaning','','2026-04','On Hold','Lucía Herrera','LATAM','Lima',520,'Marcus Webb','Document Review','SIG','On hold at business owner request; site consolidation in progress.'),
      T('TP-0022','Pinnacle Courier Group','','2026-03','Cancelled','Priya Nair','NA','Memphis TN',95,'Dana Whitfield','Questionnaire','SOC 2','Cancelled this cycle — low-risk tier re-rating; next assessment 2027.'),
      T('TP-0023','Corvid Translation Services','','2026-05','Cancelled','Jonas Weber','EMEA','Prague',40,'Olivia Grant','Questionnaire','GDPR','Cancelled — annual spend below assessment threshold.'),
      T('TP-0024','Halcyon Data Archival','','2026-02','Not Applicable','Alex Morgan','NA','Boston MA',0,'Erin Cole','Document Review','SOC 2','Discovery 2026-01: MSA expired 2025-12-31, no renewal on file. Last invoice Oct 2025. Business owner confirms migration to internal archive completed — no active service delivery.'),
      T('TP-0025','Ravello Print Studio','','2026-04','Not Applicable','Lucía Herrera','LATAM','Guadalajara',0,'Marcus Webb','Questionnaire','SIG','Discovery 2026-03: engagement dormant 9 months; final PO closed May 2025. Retained in universe as a permanent record.'),
      T('TP-0026','Wrenfield Consulting','','2026-06','Not Applicable','Amara Okafor','EMEA','Vienna',0,'Tara Singh','Document Review','GDPR, VSAQ','Discovery 2026-05: SOW ended Feb 2026; business owner confirms no successor engagement planned for 2026.'),
      T('TP-0027','Kite Mobile Testing','','2026-07','Not Applicable','Mei Tanaka','APAC','Taipei',0,'Sam Patel','Questionnaire','ISO 27001','Discovery 2026-06: no activity since device-lab closure Jan 2026. Contract lapsed; monitoring for re-engagement.'),
      T('TP-0028','Sable Point Marketing','','2026-05','Not Applicable','Priya Nair','NA','Nashville TN',0,'Dana Whitfield','Questionnaire','VSAQ','Discovery 2026-04: agency of record moved in-house Dec 2025. No current contract.'),
      T('TP-0029','Juniper Field Services','','','Planned','Diego Ramos','LATAM','Santiago',260,'Marcus Webb','On-Site Audit','SIG, ISO 27001','Awaiting scheduling — regional reviewer capacity.'),
      T('TP-0030','Corentine Insurance Brokers','','2025-11','Completed','Jonas Weber','EMEA','Zurich',310,'Olivia Grant','Document Review','DORA, GDPR'),
      T('TP-0031','Attica Warehouse Robotics','','','Planned','Arjun Rao','APAC','Osaka',445,'Sam Patel','On-Site Audit','ISO 27001, SIG, NIST CSF','Kickoff pending master agreement signature.')
  ];
}

function demoLobs_() {
  var rows = [
      ['TP-0001','Data platform hosting','Managed warehouse + ETL pipelines for finance data','K. Boyle'],
      ['TP-0001','Reporting services','Board and regulatory reporting packs','K. Boyle'],
      ['TP-0002','Payment processing','Card acquiring and settlement','R. Ellis'],
      ['TP-0003','Customer support BPO','Tier-1 support, ES/PT queues','V. Ortiz'],
      ['TP-0003','Back-office processing','Invoice and claims data entry','V. Ortiz'],
      ['TP-0004','Legal counsel','Commercial contracts, EU entities','H. Brandt'],
      ['TP-0005','Marketing analytics','Attribution modeling and dashboards','S. Lim'],
      ['TP-0006','Physical security','Guarding + CCTV monitoring, 2 sites','N. Adeyemi'],
      ['TP-0006','Access control','Badge system maintenance','N. Adeyemi'],
      ['TP-0007','Recruitment services','Technical hiring pipeline','J. Fox'],
      ['TP-0008','Network circuits','Regional MPLS + last-mile links','C. Duarte'],
      ['TP-0008','NOC services','24×7 network monitoring','C. Duarte'],
      ['TP-0009','IT staffing','Contract engineers, infra team','R. Ellis'],
      ['TP-0010','Facilities management','Cleaning, HVAC, site services','P. Visser'],
      ['TP-0011','Cloud hosting','IaaS for customer-facing apps','A. Iyer'],
      ['TP-0012','Print & mail','Statement printing and postal handling','J. Fox'],
      ['TP-0013','Claims intake','FNOL intake and triage','M. Rojas'],
      ['TP-0014','Payroll processing','Multi-state payroll runs','K. Boyle'],
      ['TP-0015','Managed SD-WAN','Branch connectivity, EU region','E. Byrne'],
      ['TP-0016','Travel management','Bookings and expense integration','S. Lim'],
      ['TP-0017','Facilities services','Office fit-out and maintenance','C. Duarte'],
      ['TP-0018','Video production','Product launch media','H. Brandt'],
      ['TP-0019','Records storage','Off-site archive and retrieval','J. Fox'],
      ['TP-0020','Data labeling','Model training data ops','A. Iyer'],
      ['TP-0021','Janitorial services','3 regional offices','M. Rojas'],
      ['TP-0022','Courier services','Inter-office document runs','R. Ellis'],
      ['TP-0023','Translation services','Localization, EU languages','H. Brandt'],
      ['TP-0024','Data archival','Cold storage of legacy records','K. Boyle'],
      ['TP-0025','Print marketing','Collateral printing','V. Ortiz'],
      ['TP-0026','Strategy consulting','Market-entry study','P. Visser'],
      ['TP-0027','Device testing','Handset compatibility lab','S. Lim'],
      ['TP-0028','Brand marketing','Regional campaign agency','J. Fox'],
      ['TP-0029','Field maintenance','Tower site servicing','C. Duarte'],
      ['TP-0030','Insurance brokerage','Corporate liability programs','E. Byrne'],
      ['TP-0031','Warehouse automation','AGV fleet and WMS integration','A. Iyer']
  ];
  return rows.map(function (r, i) {
    var n = String(i + 1);
    while (n.length < 4) n = '0' + n;
    return { lob_id: 'LOB-' + n, tp_id: r[0], line_of_business: r[1], service_description: r[2], vendor_manager: r[3] };
  });
}

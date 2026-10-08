/* ============================================================
   CBT Platform — SHARED file (browser + Google Apps Script)

   • Browser:      loaded by index.html via <script src="cbt-shared.js">
   • Apps Script:  paste this file's contents into a script file named
                   "cbt-shared.gs" in the same project as Code.gs

   It holds everything both sides must agree on: the cadre list, the
   scope/group rules, the answer-grading logic and the base question
   banks. Use `var` and function declarations only, and do not refer to
   anything defined in another file at top level (Apps Script loads its
   files in editor order, so top-level cross-file references can be
   undefined).
   ============================================================ */

/* ---------- scope names (question.scope / user.cadre) ---------- */
var ICT_CADRE="Information & Communication Technology (ICT) Cadre";
var PS_CADRE="Permanent Secretary Cadre";
var TRAFFIC_CADRE="Traffic Management Officer Cadre (LASTMA)";
var VIO_CADRE="Vehicle Inspection Officer Cadre (VIS)";
var ENV_CADRE="Environmental & Special Offences Enforcement Cadre";
var LNSC_CADRE="Neighbourhood Safety Corps Cadre (LNSC)";
/* A GROUP scope is a question bank shared by several cadres. */
var LE_GROUP="GROUP: Law Enforcement (all enforcement cadres)";
var CADRE_GROUPS={};
CADRE_GROUPS[TRAFFIC_CADRE]=LE_GROUP;
CADRE_GROUPS[VIO_CADRE]=LE_GROUP;
CADRE_GROUPS[ENV_CADRE]=LE_GROUP;
CADRE_GROUPS[LNSC_CADRE]=LE_GROUP;
var SCOPE_GROUPS=[LE_GROUP];

function cadreGroupOf(cadre){return (cadre&&CADRE_GROUPS[cadre])||null;}
/* true when a question with this scope belongs in this cadre's practice pool */
function scopeVisibleTo(scope,cadre){
  if(scope==="COMMON")return true;
  if(!cadre)return false;
  return scope===cadre||scope===cadreGroupOf(cadre);
}
function findCadre(name){for(var i=0;i<CADRES.length;i++)if(CADRES[i].name===name)return CADRES[i];return null;}

/* ---------- answer grading (identical on client and server) ---------- */
/* Numbers compare by value ("₦1,500.00" = "1500"); text ignores case,
   surrounding punctuation and extra spaces. Decimal points inside numbers
   are kept, so "3.5" no longer matches "35". */
function cbtNormAnswer(s){
  var t=String(s==null?"":s).toLowerCase().replace(/₦/g,"").replace(/\b(ngn|naira)\b/g,"").trim();
  var n=t.replace(/(\d),(?=\d{3}(\D|$))/g,"$1").replace(/\s+/g,"");
  if(/^[-+]?\d+(\.\d+)?$/.test(n))return "#"+parseFloat(n);
  return t.replace(/[.,;:!?'"`()]/g,"").replace(/\s+/g," ").trim();
}
function cbtGrade(q,r){
  if(!q)return false;
  switch(q.type){
    case "mcq":return typeof r==="number"&&r===Number(q.answer);
    case "truefalse":return typeof r==="boolean"&&r===(q.answer===true||q.answer==="true");
    case "shortanswer":
      if(r==null||!String(r).trim())return false;
      var g=cbtNormAnswer(r);
      return (q.accept||[]).some(function(a){return cbtNormAnswer(a)===g;});
    case "ordering":
      return Array.isArray(r)&&Array.isArray(q.items)&&r.length===q.items.length&&
        q.items.every(function(it,i){return r[i]===it;});
    case "matching":
      return !!r&&typeof r==="object"&&Array.isArray(q.pairs)&&q.pairs.length>0&&
        q.pairs.every(function(p){return r[p.l]===p.r;});
  }
  return false;
}

/* ---------- seed banks registry (resolved lazily at run time) ---------- */
function getSeedBanks(){
  var b=[];
  if(typeof SEED_ICT!=="undefined")b.push({key:"ict",legacyFlag:"ictSeeded",scope:ICT_CADRE,data:SEED_ICT});
  if(typeof SEED_PERMSEC!=="undefined")b.push({key:"permsec",scope:PS_CADRE,data:SEED_PERMSEC});
  if(typeof SEED_LE_GENERAL!=="undefined")b.push({key:"le_general",scope:LE_GROUP,data:SEED_LE_GENERAL});
  if(typeof SEED_TRAFFIC!=="undefined")b.push({key:"traffic",scope:TRAFFIC_CADRE,data:SEED_TRAFFIC});
  if(typeof SEED_VIO!=="undefined")b.push({key:"vio",scope:VIO_CADRE,data:SEED_VIO});
  if(typeof SEED_ENV!=="undefined")b.push({key:"env",scope:ENV_CADRE,data:SEED_ENV});
  if(typeof SEED_LNSC!=="undefined")b.push({key:"lnsc",scope:LNSC_CADRE,data:SEED_LNSC});
  return b;
}

/* ---------- cadres & grade ladders ---------- */
var CADRES = [{"name": "Administrative Officer Cadre", "levels": [{"gl": "08", "post": "Administrative Officer II"}, {"gl": "09", "post": "Administrative Officer"}, {"gl": "10", "post": "Senior Administrative Officer"}, {"gl": "12", "post": "Principal Administrative Officer I"}, {"gl": "13", "post": "Chief Administrative Officer"}, {"gl": "14", "post": "Assistant Director (Admin & Human Resources)"}, {"gl": "15", "post": "Deputy Director (Admin & Human Resources)"}, {"gl": "16", "post": "Director (Admin & Human Resources)"}]}, {"name": "Executive Officer (General Duties) Cadre", "levels": [{"gl": "06", "post": "Assistant Executive Officer (GD)"}, {"gl": "07", "post": "Executive Officer (GD)"}, {"gl": "08", "post": "Higher Executive Officer (GD)"}, {"gl": "09", "post": "Senior Executive Officer (GD)"}, {"gl": "10", "post": "Principal Executive Officer II (GD)"}, {"gl": "12", "post": "Principal Executive Officer I (GD)"}, {"gl": "13", "post": "Assistant Chief Executive Officer (GD)"}, {"gl": "14", "post": "Chief Executive Officer (GD)"}]}, {"name": "Executive Officer (Accounts) Cadre", "levels": [{"gl": "06", "post": "Assistant Executive Officer (Accounts)"}, {"gl": "07", "post": "Executive Officer (Accounts)"}, {"gl": "08", "post": "Higher Executive Officer (Accounts)"}, {"gl": "09", "post": "Senior Executive Officer (Accounts)"}, {"gl": "10", "post": "Principal Executive Officer II (Accounts)"}, {"gl": "12", "post": "Principal Executive Officer I (Accounts)"}, {"gl": "13", "post": "Assistant Chief Executive Officer (Accounts)"}, {"gl": "14", "post": "Chief Executive Officer (Accounts)"}]}, {"name": "Executive Officer (Audit) Cadre", "levels": [{"gl": "06", "post": "Assistant Executive Officer (Audit)"}, {"gl": "07", "post": "Executive Officer (Audit)"}, {"gl": "08", "post": "Higher Executive Officer (Audit)"}, {"gl": "09", "post": "Senior Executive Officer (Audit)"}, {"gl": "10", "post": "Principal Executive Officer II (Audit)"}, {"gl": "12", "post": "Principal Executive Officer I (Audit)"}, {"gl": "13", "post": "Assistant Chief Executive Officer (Audit)"}, {"gl": "14", "post": "Chief Executive Officer (Audit)"}]}, {"name": "Executive Officer (Information) Cadre", "levels": [{"gl": "06", "post": "Assistant Executive Officer (Information)"}, {"gl": "07", "post": "Executive Officer (Information)"}, {"gl": "08", "post": "Higher Executive Officer (Information)"}, {"gl": "09", "post": "Senior Executive Officer (Information)"}, {"gl": "10", "post": "Principal Executive Officer II (Information)"}, {"gl": "12", "post": "Principal Executive Officer I (Information)"}, {"gl": "13", "post": "Assistant Chief Executive Officer (Information)"}, {"gl": "14", "post": "Chief Executive Officer (Information)"}]}, {"name": "Clerical Cadre", "levels": [{"gl": "03", "post": "Clerical Assistant"}, {"gl": "04", "post": "Clerical Officer II"}, {"gl": "05", "post": "Clerical Officer I"}, {"gl": "06", "post": "Senior Clerical Officer"}, {"gl": "07", "post": "Chief Clerical Officer"}]}, {"name": "Assistant Secretarial Officer Cadre", "levels": [{"gl": "04", "post": "Assistant Secretarial Officer II"}, {"gl": "05", "post": "Assistant Secretarial Officer"}, {"gl": "06", "post": "Senior Assistant Secretarial Officer II"}, {"gl": "07", "post": "Senior Assistant Secretarial Officer I"}, {"gl": "09", "post": "Chief Assistant Secretarial Officer II"}, {"gl": "10", "post": "Chief Assistant Secretarial Officer"}]}, {"name": "Secretarial Officer Cadre (Confidential Secretary)", "levels": [{"gl": "05", "post": "Secretarial Officer IV"}, {"gl": "06", "post": "Secretarial Officer III"}, {"gl": "07", "post": "Secretarial Officer II"}, {"gl": "08", "post": "Secretarial Officer I"}, {"gl": "09", "post": "Senior Secretarial Officer"}, {"gl": "10", "post": "Principal Secretarial Officer II"}, {"gl": "12", "post": "Principal Secretarial Officer I"}, {"gl": "13", "post": "Assistant Chief Secretarial Officer"}, {"gl": "14", "post": "Chief Secretarial Officer"}]}, {"name": "Storekeeper Cadre", "levels": [{"gl": "03", "post": "Stores Assistant"}, {"gl": "04", "post": "Storekeeper"}, {"gl": "05", "post": "Senior Storekeeper"}, {"gl": "06", "post": "Assistant Chief Storekeeper"}, {"gl": "07", "post": "Chief Storekeeper"}]}, {"name": "Stores Officer Cadre", "levels": [{"gl": "06", "post": "Assistant Stores Officer"}, {"gl": "07", "post": "Stores Officer"}, {"gl": "08", "post": "Higher Stores Officer"}, {"gl": "09", "post": "Senior Stores Officer"}, {"gl": "10", "post": "Principal Stores Officer II"}, {"gl": "12", "post": "Principal Stores Officer I"}, {"gl": "13", "post": "Assistant Chief Stores Officer"}, {"gl": "14", "post": "Chief Stores Officer"}]}, {"name": "Information & Communication Technology (ICT) Cadre", "levels": [{"gl": "06", "post": "ICT Assistant / Assistant Data Processing Officer"}, {"gl": "07", "post": "Data Processing Officer / Systems Programmer"}, {"gl": "08", "post": "Higher Data Processing Officer / Systems Analyst II"}, {"gl": "09", "post": "Senior Data Processing Officer / Systems Analyst I"}, {"gl": "10", "post": "Principal Systems Analyst II / Network Administrator II"}, {"gl": "12", "post": "Principal Systems Analyst I / Database Administrator"}, {"gl": "13", "post": "Assistant Chief ICT Officer / Computer Engineer"}, {"gl": "14", "post": "Chief ICT Officer"}, {"gl": "15", "post": "Assistant Director (ICT)"}, {"gl": "16", "post": "Deputy Director (ICT)"}, {"gl": "17", "post": "Director (ICT)"}]}, {"name": "Library Officer Cadre", "levels": [{"gl": "06", "post": "Assistant Library Officer"}, {"gl": "07", "post": "Library Officer"}, {"gl": "08", "post": "Higher Library Officer"}, {"gl": "09", "post": "Senior Library Officer"}, {"gl": "10", "post": "Principal Library Officer"}, {"gl": "12", "post": "Assistant Chief Library Officer"}, {"gl": "13", "post": "Chief Library Officer"}]}, {"name": "Librarian Cadre", "levels": [{"gl": "08", "post": "Librarian"}, {"gl": "09", "post": "Senior Librarian"}, {"gl": "10", "post": "Principal Librarian"}, {"gl": "12", "post": "Assistant Chief Librarian"}, {"gl": "13", "post": "Chief Librarian"}, {"gl": "14", "post": "Assistant Director (Library)"}, {"gl": "15", "post": "Deputy Director (Library)"}, {"gl": "16", "post": "Director (Library)"}]}, {"name": "Teacher / Headmaster Cadre", "levels": [{"gl": "05", "post": "Teacher Grade II"}, {"gl": "07", "post": "Teacher Grade I / Master II"}, {"gl": "08", "post": "Headmaster II"}, {"gl": "09", "post": "Headmaster"}, {"gl": "10", "post": "Headmaster Special II"}, {"gl": "12", "post": "Headmaster Special I"}]}, {"name": "Assistant Education Officer Cadre", "levels": [{"gl": "07", "post": "Assistant Education Officer"}, {"gl": "08", "post": "Higher Assistant Education Officer"}, {"gl": "09", "post": "Senior Assistant Education Officer II"}, {"gl": "10", "post": "Senior Assistant Education Officer"}, {"gl": "12", "post": "Principal Assistant Education Officer II"}, {"gl": "13", "post": "Principal Assistant Education Officer I"}, {"gl": "14", "post": "Chief Assistant Education Officer"}]}, {"name": "Education Officer Cadre", "levels": [{"gl": "08", "post": "Education Officer II"}, {"gl": "09", "post": "Education Officer I"}, {"gl": "10", "post": "Senior Education Officer"}, {"gl": "12", "post": "Principal Education Officer"}, {"gl": "13", "post": "Assistant Chief Education Officer"}, {"gl": "14", "post": "Chief Education Officer"}, {"gl": "15", "post": "Assistant Director (Education)"}, {"gl": "16", "post": "Deputy Director (Education)"}, {"gl": "17", "post": "Director (Education)"}]}, {"name": "Catering Officer Cadre", "levels": [{"gl": "06", "post": "Assistant Catering Officer"}, {"gl": "07", "post": "Catering Officer"}, {"gl": "08", "post": "Higher Catering Officer"}, {"gl": "09", "post": "Senior Catering Officer"}, {"gl": "10", "post": "Principal Catering Officer"}, {"gl": "12", "post": "Assistant Chief Catering Officer"}, {"gl": "13", "post": "Chief Catering Officer"}]}, {"name": "Catering Assistant Cadre", "levels": [{"gl": "04", "post": "Catering Assistant"}, {"gl": "05", "post": "Senior Catering Assistant II"}, {"gl": "06", "post": "Senior Catering Assistant I"}, {"gl": "07", "post": "Chief Catering Assistant"}]}, {"name": "Driver Cadre", "levels": [{"gl": "03", "post": "Motor Driver"}, {"gl": "04", "post": "Motor Driver-Mechanic"}, {"gl": "05", "post": "Senior Motor Driver-Mechanic II"}, {"gl": "06", "post": "Senior Motor Driver-Mechanic I"}, {"gl": "07", "post": "Chief Motor Driver-Mechanic"}]}, {"name": "Messenger Cadre", "levels": [{"gl": "02", "post": "Messenger"}, {"gl": "03", "post": "Senior Messenger"}, {"gl": "04", "post": "Head Messenger"}]}, {"name": "Watchman Cadre", "levels": [{"gl": "01", "post": "Watchman"}, {"gl": "02", "post": "Watchman II"}, {"gl": "03", "post": "Higher Watchman"}, {"gl": "04", "post": "Senior Watchman"}, {"gl": "05", "post": "Head Watchman"}]}, {"name": "Cleaner Cadre", "levels": [{"gl": "01", "post": "Cleaner"}, {"gl": "02", "post": "Senior Cleaner"}, {"gl": "03", "post": "Head Cleaner"}]}, {"name": "Gardener Cadre", "levels": [{"gl": "02", "post": "Gardener"}, {"gl": "03", "post": "Head Gardener"}]}, {"name": "Medical Officer Cadre", "levels": [{"gl": "08", "post": "Medical Officer II"}, {"gl": "09", "post": "Medical Officer I"}, {"gl": "10", "post": "Senior Medical Officer"}, {"gl": "12", "post": "Principal Medical Officer"}, {"gl": "13", "post": "Assistant Chief Medical Officer"}, {"gl": "14", "post": "Chief Medical Officer"}, {"gl": "15", "post": "Assistant Director (Medical Services)"}, {"gl": "16", "post": "Deputy Director (Medical Services)"}, {"gl": "17", "post": "Director (Medical Services)"}]}, {"name": "Nursing Officer Cadre", "levels": [{"gl": "08", "post": "Nursing Officer II"}, {"gl": "09", "post": "Nursing Officer I"}, {"gl": "10", "post": "Senior Nursing Officer"}, {"gl": "12", "post": "Principal Nursing Officer"}, {"gl": "13", "post": "Assistant Chief Nursing Officer"}, {"gl": "14", "post": "Chief Nursing Officer"}, {"gl": "15", "post": "Assistant Director (Nursing Services)"}, {"gl": "16", "post": "Deputy Director (Nursing Services)"}, {"gl": "17", "post": "Director (Nursing Services)"}]}, {"name": "Midwifery Cadre", "levels": [{"gl": "08", "post": "Midwife II"}, {"gl": "09", "post": "Midwife I"}, {"gl": "10", "post": "Senior Midwife"}, {"gl": "12", "post": "Principal Midwife"}, {"gl": "13", "post": "Assistant Chief Midwife"}, {"gl": "14", "post": "Chief Midwife"}, {"gl": "15", "post": "Assistant Director (Nursing Services)"}, {"gl": "16", "post": "Deputy Director (Nursing Services)"}, {"gl": "17", "post": "Director (Nursing Services)"}]}, {"name": "Community Health Cadre", "levels": [{"gl": "08", "post": "Community Health Officer II"}, {"gl": "09", "post": "Community Health Officer I"}, {"gl": "10", "post": "Senior Community Health Officer"}, {"gl": "12", "post": "Principal Community Health Officer"}, {"gl": "13", "post": "Assistant Chief Community Health Officer"}, {"gl": "14", "post": "Chief Community Health Officer"}, {"gl": "15", "post": "Assistant Director (Community Health Services)"}, {"gl": "16", "post": "Deputy Director (Community Health Services)"}, {"gl": "17", "post": "Director (Community Health Services)"}]}, {"name": "Pharmacy Cadre", "levels": [{"gl": "08", "post": "Pharmacist II"}, {"gl": "09", "post": "Pharmacist I"}, {"gl": "10", "post": "Senior Pharmacist"}, {"gl": "12", "post": "Principal Pharmacist"}, {"gl": "13", "post": "Assistant Chief Pharmacist"}, {"gl": "14", "post": "Chief Pharmacist"}, {"gl": "15", "post": "Assistant Director (Pharmaceutical Services)"}, {"gl": "16", "post": "Deputy Director (Pharmaceutical Services)"}, {"gl": "17", "post": "Director (Pharmaceutical Services)"}]}, {"name": "Medical Laboratory Science Cadre", "levels": [{"gl": "08", "post": "Medical Laboratory Scientist II"}, {"gl": "09", "post": "Medical Laboratory Scientist I"}, {"gl": "10", "post": "Senior Medical Laboratory Scientist"}, {"gl": "12", "post": "Principal Medical Laboratory Scientist"}, {"gl": "13", "post": "Assistant Chief Medical Laboratory Scientist"}, {"gl": "14", "post": "Chief Medical Laboratory Scientist"}, {"gl": "15", "post": "Assistant Director (Medical Laboratory Services)"}, {"gl": "16", "post": "Deputy Director (Medical Laboratory Services)"}, {"gl": "17", "post": "Director (Medical Laboratory Services)"}]}, {"name": "Radiography Cadre", "levels": [{"gl": "08", "post": "Radiographer II"}, {"gl": "09", "post": "Radiographer I"}, {"gl": "10", "post": "Senior Radiographer"}, {"gl": "12", "post": "Principal Radiographer"}, {"gl": "13", "post": "Assistant Chief Radiographer"}, {"gl": "14", "post": "Chief Radiographer"}, {"gl": "15", "post": "Assistant Director (Radiography Services)"}, {"gl": "16", "post": "Deputy Director (Radiography Services)"}, {"gl": "17", "post": "Director (Radiography Services)"}]}, {"name": "Physiotherapy Cadre", "levels": [{"gl": "08", "post": "Physiotherapist II"}, {"gl": "09", "post": "Physiotherapist I"}, {"gl": "10", "post": "Senior Physiotherapist"}, {"gl": "12", "post": "Principal Physiotherapist"}, {"gl": "13", "post": "Assistant Chief Physiotherapist"}, {"gl": "14", "post": "Chief Physiotherapist"}, {"gl": "15", "post": "Assistant Director (Physiotherapy Services)"}, {"gl": "16", "post": "Deputy Director (Physiotherapy Services)"}, {"gl": "17", "post": "Director (Physiotherapy Services)"}]}, {"name": "Dental Cadre", "levels": [{"gl": "08", "post": "Dental Therapist II"}, {"gl": "09", "post": "Dental Therapist I"}, {"gl": "10", "post": "Senior Dental Therapist"}, {"gl": "12", "post": "Principal Dental Therapist"}, {"gl": "13", "post": "Assistant Chief Dental Therapist"}, {"gl": "14", "post": "Chief Dental Therapist"}, {"gl": "15", "post": "Assistant Director (Dental Services)"}, {"gl": "16", "post": "Deputy Director (Dental Services)"}, {"gl": "17", "post": "Director (Dental Services)"}]}, {"name": "Health Records Cadre", "levels": [{"gl": "08", "post": "Health Records Officer II"}, {"gl": "09", "post": "Health Records Officer I"}, {"gl": "10", "post": "Senior Health Records Officer"}, {"gl": "12", "post": "Principal Health Records Officer"}, {"gl": "13", "post": "Assistant Chief Health Records Officer"}, {"gl": "14", "post": "Chief Health Records Officer"}, {"gl": "15", "post": "Assistant Director (Health Records)"}, {"gl": "16", "post": "Deputy Director (Health Records)"}, {"gl": "17", "post": "Director (Health Records)"}]}, {"name": "Environmental Health Cadre", "levels": [{"gl": "08", "post": "Environmental Health Officer II"}, {"gl": "09", "post": "Environmental Health Officer I"}, {"gl": "10", "post": "Senior Environmental Health Officer"}, {"gl": "12", "post": "Principal Environmental Health Officer"}, {"gl": "13", "post": "Assistant Chief Environmental Health Officer"}, {"gl": "14", "post": "Chief Environmental Health Officer"}, {"gl": "15", "post": "Assistant Director (Environmental Health)"}, {"gl": "16", "post": "Deputy Director (Environmental Health)"}, {"gl": "17", "post": "Director (Environmental Health)"}]}, {"name": "Civil Engineering Cadre", "levels": [{"gl": "08", "post": "Civil Engineer II"}, {"gl": "09", "post": "Civil Engineer I"}, {"gl": "10", "post": "Senior Civil Engineer"}, {"gl": "12", "post": "Principal Civil Engineer"}, {"gl": "13", "post": "Assistant Chief Civil Engineer"}, {"gl": "14", "post": "Chief Civil Engineer"}, {"gl": "15", "post": "Assistant Director (Engineering)"}, {"gl": "16", "post": "Deputy Director (Engineering)"}, {"gl": "17", "post": "Director (Engineering)"}]}, {"name": "Mechanical Engineering Cadre", "levels": [{"gl": "08", "post": "Mechanical Engineer II"}, {"gl": "09", "post": "Mechanical Engineer I"}, {"gl": "10", "post": "Senior Mechanical Engineer"}, {"gl": "12", "post": "Principal Mechanical Engineer"}, {"gl": "13", "post": "Assistant Chief Mechanical Engineer"}, {"gl": "14", "post": "Chief Mechanical Engineer"}, {"gl": "15", "post": "Assistant Director (Engineering)"}, {"gl": "16", "post": "Deputy Director (Engineering)"}, {"gl": "17", "post": "Director (Engineering)"}]}, {"name": "Electrical Engineering Cadre", "levels": [{"gl": "08", "post": "Electrical Engineer II"}, {"gl": "09", "post": "Electrical Engineer I"}, {"gl": "10", "post": "Senior Electrical Engineer"}, {"gl": "12", "post": "Principal Electrical Engineer"}, {"gl": "13", "post": "Assistant Chief Electrical Engineer"}, {"gl": "14", "post": "Chief Electrical Engineer"}, {"gl": "15", "post": "Assistant Director (Engineering)"}, {"gl": "16", "post": "Deputy Director (Engineering)"}, {"gl": "17", "post": "Director (Engineering)"}]}, {"name": "Structural Engineering Cadre", "levels": [{"gl": "08", "post": "Structural Engineer II"}, {"gl": "09", "post": "Structural Engineer I"}, {"gl": "10", "post": "Senior Structural Engineer"}, {"gl": "12", "post": "Principal Structural Engineer"}, {"gl": "13", "post": "Assistant Chief Structural Engineer"}, {"gl": "14", "post": "Chief Structural Engineer"}, {"gl": "15", "post": "Assistant Director (Engineering)"}, {"gl": "16", "post": "Deputy Director (Engineering)"}, {"gl": "17", "post": "Director (Engineering)"}]}, {"name": "Architecture Cadre", "levels": [{"gl": "08", "post": "Architect II"}, {"gl": "09", "post": "Architect I"}, {"gl": "10", "post": "Senior Architect"}, {"gl": "12", "post": "Principal Architect"}, {"gl": "13", "post": "Assistant Chief Architect"}, {"gl": "14", "post": "Chief Architect"}, {"gl": "15", "post": "Assistant Director (Architecture)"}, {"gl": "16", "post": "Deputy Director (Architecture)"}, {"gl": "17", "post": "Director (Architecture)"}]}, {"name": "Town Planning Cadre", "levels": [{"gl": "08", "post": "Town Planning Officer II"}, {"gl": "09", "post": "Town Planning Officer I"}, {"gl": "10", "post": "Senior Town Planning Officer"}, {"gl": "12", "post": "Principal Town Planning Officer"}, {"gl": "13", "post": "Assistant Chief Town Planning Officer"}, {"gl": "14", "post": "Chief Town Planning Officer"}, {"gl": "15", "post": "Assistant Director (Town Planning)"}, {"gl": "16", "post": "Deputy Director (Town Planning)"}, {"gl": "17", "post": "Director (Town Planning)"}]}, {"name": "Quantity Surveying Cadre", "levels": [{"gl": "08", "post": "Quantity Surveyor II"}, {"gl": "09", "post": "Quantity Surveyor I"}, {"gl": "10", "post": "Senior Quantity Surveyor"}, {"gl": "12", "post": "Principal Quantity Surveyor"}, {"gl": "13", "post": "Assistant Chief Quantity Surveyor"}, {"gl": "14", "post": "Chief Quantity Surveyor"}, {"gl": "15", "post": "Assistant Director (Quantity Surveying)"}, {"gl": "16", "post": "Deputy Director (Quantity Surveying)"}, {"gl": "17", "post": "Director (Quantity Surveying)"}]}, {"name": "Land Surveying Cadre", "levels": [{"gl": "08", "post": "Surveyor II"}, {"gl": "09", "post": "Surveyor I"}, {"gl": "10", "post": "Senior Surveyor"}, {"gl": "12", "post": "Principal Surveyor"}, {"gl": "13", "post": "Assistant Chief Surveyor"}, {"gl": "14", "post": "Chief Surveyor"}, {"gl": "15", "post": "Assistant Director (Surveying)"}, {"gl": "16", "post": "Deputy Director (Surveying)"}, {"gl": "17", "post": "Director (Surveying)"}]}, {"name": "Estate Management Cadre", "levels": [{"gl": "08", "post": "Estate Officer II"}, {"gl": "09", "post": "Estate Officer I"}, {"gl": "10", "post": "Senior Estate Officer"}, {"gl": "12", "post": "Principal Estate Officer"}, {"gl": "13", "post": "Assistant Chief Estate Officer"}, {"gl": "14", "post": "Chief Estate Officer"}, {"gl": "15", "post": "Assistant Director (Estate Management)"}, {"gl": "16", "post": "Deputy Director (Estate Management)"}, {"gl": "17", "post": "Director (Estate Management)"}]}, {"name": "Agriculture Cadre", "levels": [{"gl": "08", "post": "Agricultural Officer II"}, {"gl": "09", "post": "Agricultural Officer I"}, {"gl": "10", "post": "Senior Agricultural Officer"}, {"gl": "12", "post": "Principal Agricultural Officer"}, {"gl": "13", "post": "Assistant Chief Agricultural Officer"}, {"gl": "14", "post": "Chief Agricultural Officer"}, {"gl": "15", "post": "Assistant Director (Agriculture)"}, {"gl": "16", "post": "Deputy Director (Agriculture)"}, {"gl": "17", "post": "Director (Agriculture)"}]}, {"name": "Fisheries Cadre", "levels": [{"gl": "08", "post": "Fisheries Officer II"}, {"gl": "09", "post": "Fisheries Officer I"}, {"gl": "10", "post": "Senior Fisheries Officer"}, {"gl": "12", "post": "Principal Fisheries Officer"}, {"gl": "13", "post": "Assistant Chief Fisheries Officer"}, {"gl": "14", "post": "Chief Fisheries Officer"}, {"gl": "15", "post": "Assistant Director (Agriculture)"}, {"gl": "16", "post": "Deputy Director (Agriculture)"}, {"gl": "17", "post": "Director (Agriculture)"}]}, {"name": "Produce Inspection Cadre", "levels": [{"gl": "08", "post": "Produce Officer II"}, {"gl": "09", "post": "Produce Officer I"}, {"gl": "10", "post": "Senior Produce Officer"}, {"gl": "12", "post": "Principal Produce Officer"}, {"gl": "13", "post": "Assistant Chief Produce Officer"}, {"gl": "14", "post": "Chief Produce Officer"}, {"gl": "15", "post": "Assistant Director (Agriculture)"}, {"gl": "16", "post": "Deputy Director (Agriculture)"}, {"gl": "17", "post": "Director (Agriculture)"}]}, {"name": "Veterinary Cadre", "levels": [{"gl": "08", "post": "Veterinary Officer II"}, {"gl": "09", "post": "Veterinary Officer I"}, {"gl": "10", "post": "Senior Veterinary Officer"}, {"gl": "12", "post": "Principal Veterinary Officer"}, {"gl": "13", "post": "Assistant Chief Veterinary Officer"}, {"gl": "14", "post": "Chief Veterinary Officer"}, {"gl": "15", "post": "Assistant Director (Veterinary Services)"}, {"gl": "16", "post": "Deputy Director (Veterinary Services)"}, {"gl": "17", "post": "Director (Veterinary Services)"}]}, {"name": "Forestry Cadre", "levels": [{"gl": "08", "post": "Forestry Officer II"}, {"gl": "09", "post": "Forestry Officer I"}, {"gl": "10", "post": "Senior Forestry Officer"}, {"gl": "12", "post": "Principal Forestry Officer"}, {"gl": "13", "post": "Assistant Chief Forestry Officer"}, {"gl": "14", "post": "Chief Forestry Officer"}, {"gl": "15", "post": "Assistant Director (Forestry)"}, {"gl": "16", "post": "Deputy Director (Forestry)"}, {"gl": "17", "post": "Director (Forestry)"}]}, {"name": "Geology Cadre", "levels": [{"gl": "08", "post": "Geologist II"}, {"gl": "09", "post": "Geologist I"}, {"gl": "10", "post": "Senior Geologist"}, {"gl": "12", "post": "Principal Geologist"}, {"gl": "13", "post": "Assistant Chief Geologist"}, {"gl": "14", "post": "Chief Geologist"}, {"gl": "15", "post": "Assistant Director (Geology)"}, {"gl": "16", "post": "Deputy Director (Geology)"}, {"gl": "17", "post": "Director (Geology)"}]}, {"name": "Scientific Officer (Mining) Cadre", "levels": [{"gl": "08", "post": "Scientific Officer (Mining) II"}, {"gl": "09", "post": "Scientific Officer (Mining) I"}, {"gl": "10", "post": "Senior Scientific Officer (Mining)"}, {"gl": "12", "post": "Principal Scientific Officer (Mining)"}, {"gl": "13", "post": "Assistant Chief Scientific Officer (Mining)"}, {"gl": "14", "post": "Chief Scientific Officer (Mining)"}, {"gl": "15", "post": "Assistant Director (Science)"}, {"gl": "16", "post": "Deputy Director (Science)"}, {"gl": "17", "post": "Director (Science)"}]}, {"name": "Scientific Officer (Water) Cadre", "levels": [{"gl": "08", "post": "Scientific Officer (Water) II"}, {"gl": "09", "post": "Scientific Officer (Water) I"}, {"gl": "10", "post": "Senior Scientific Officer (Water)"}, {"gl": "12", "post": "Principal Scientific Officer (Water)"}, {"gl": "13", "post": "Assistant Chief Scientific Officer (Water)"}, {"gl": "14", "post": "Chief Scientific Officer (Water)"}, {"gl": "15", "post": "Assistant Director (Science)"}, {"gl": "16", "post": "Deputy Director (Science)"}, {"gl": "17", "post": "Director (Science)"}]}, {"name": "Legal Cadre", "levels": [{"gl": "08", "post": "State Counsel II"}, {"gl": "09", "post": "State Counsel I"}, {"gl": "10", "post": "Senior State Counsel"}, {"gl": "12", "post": "Principal State Counsel"}, {"gl": "13", "post": "Assistant Chief State Counsel"}, {"gl": "14", "post": "Chief State Counsel"}, {"gl": "15", "post": "Assistant Director (Legal Services)"}, {"gl": "16", "post": "Deputy Director (Legal Services)"}, {"gl": "17", "post": "Director (Legal Services)"}]}, {"name": "Statistics Cadre (graduate)", "levels": [{"gl": "08", "post": "Statistician II"}, {"gl": "09", "post": "Statistician I"}, {"gl": "10", "post": "Senior Statistician"}, {"gl": "12", "post": "Principal Statistician"}, {"gl": "13", "post": "Assistant Chief Statistician"}, {"gl": "14", "post": "Chief Statistician"}, {"gl": "15", "post": "Assistant Director (Statistics)"}, {"gl": "16", "post": "Deputy Director (Statistics)"}, {"gl": "17", "post": "Director (Statistics)"}]}, {"name": "Economic Planning Cadre", "levels": [{"gl": "08", "post": "Economic Planning Officer II"}, {"gl": "09", "post": "Economic Planning Officer I"}, {"gl": "10", "post": "Senior Economic Planning Officer"}, {"gl": "12", "post": "Principal Economic Planning Officer"}, {"gl": "13", "post": "Assistant Chief Economic Planning Officer"}, {"gl": "14", "post": "Chief Economic Planning Officer"}, {"gl": "15", "post": "Assistant Director (Economic Planning)"}, {"gl": "16", "post": "Deputy Director (Economic Planning)"}, {"gl": "17", "post": "Director (Economic Planning)"}]}, {"name": "Research Cadre", "levels": [{"gl": "08", "post": "Research Officer II"}, {"gl": "09", "post": "Research Officer I"}, {"gl": "10", "post": "Senior Research Officer"}, {"gl": "12", "post": "Principal Research Officer"}, {"gl": "13", "post": "Assistant Chief Research Officer"}, {"gl": "14", "post": "Chief Research Officer"}, {"gl": "15", "post": "Assistant Director (Research)"}, {"gl": "16", "post": "Deputy Director (Research)"}, {"gl": "17", "post": "Director (Research)"}]}, {"name": "Social Welfare Cadre", "levels": [{"gl": "08", "post": "Social Welfare Officer II"}, {"gl": "09", "post": "Social Welfare Officer I"}, {"gl": "10", "post": "Senior Social Welfare Officer"}, {"gl": "12", "post": "Principal Social Welfare Officer"}, {"gl": "13", "post": "Assistant Chief Social Welfare Officer"}, {"gl": "14", "post": "Chief Social Welfare Officer"}, {"gl": "15", "post": "Assistant Director (Social Welfare)"}, {"gl": "16", "post": "Deputy Director (Social Welfare)"}, {"gl": "17", "post": "Director (Social Welfare)"}]}, {"name": "Community Development Cadre", "levels": [{"gl": "08", "post": "Community Development Officer II"}, {"gl": "09", "post": "Community Development Officer I"}, {"gl": "10", "post": "Senior Community Development Officer"}, {"gl": "12", "post": "Principal Community Development Officer"}, {"gl": "13", "post": "Assistant Chief Community Development Officer"}, {"gl": "14", "post": "Chief Community Development Officer"}, {"gl": "15", "post": "Assistant Director (Community Development)"}, {"gl": "16", "post": "Deputy Director (Community Development)"}, {"gl": "17", "post": "Director (Community Development)"}]}, {"name": "Accountant Cadre (graduate)", "levels": [{"gl": "08", "post": "Accountant II"}, {"gl": "09", "post": "Accountant I"}, {"gl": "10", "post": "Senior Accountant"}, {"gl": "12", "post": "Principal Accountant"}, {"gl": "13", "post": "Assistant Chief Accountant"}, {"gl": "14", "post": "Chief Accountant"}, {"gl": "15", "post": "Assistant Director (Finance & Accounts)"}, {"gl": "16", "post": "Deputy Director (Finance & Accounts)"}, {"gl": "17", "post": "Director (Finance & Accounts)"}]}, {"name": "Internal Audit Cadre", "levels": [{"gl": "08", "post": "Internal Auditor II"}, {"gl": "09", "post": "Internal Auditor I"}, {"gl": "10", "post": "Senior Internal Auditor"}, {"gl": "12", "post": "Principal Internal Auditor"}, {"gl": "13", "post": "Assistant Chief Internal Auditor"}, {"gl": "14", "post": "Chief Internal Auditor"}, {"gl": "15", "post": "Assistant Director (Internal Audit)"}, {"gl": "16", "post": "Deputy Director (Internal Audit)"}, {"gl": "17", "post": "Director (Internal Audit)"}]}, {"name": "Procurement Cadre", "levels": [{"gl": "08", "post": "Procurement Officer II"}, {"gl": "09", "post": "Procurement Officer I"}, {"gl": "10", "post": "Senior Procurement Officer"}, {"gl": "12", "post": "Principal Procurement Officer"}, {"gl": "13", "post": "Assistant Chief Procurement Officer"}, {"gl": "14", "post": "Chief Procurement Officer"}, {"gl": "15", "post": "Assistant Director (Procurement)"}, {"gl": "16", "post": "Deputy Director (Procurement)"}, {"gl": "17", "post": "Director (Procurement)"}]}, {"name": "Information Cadre", "levels": [{"gl": "08", "post": "Information Officer II"}, {"gl": "09", "post": "Information Officer I"}, {"gl": "10", "post": "Senior Information Officer"}, {"gl": "12", "post": "Principal Information Officer"}, {"gl": "13", "post": "Assistant Chief Information Officer"}, {"gl": "14", "post": "Chief Information Officer"}, {"gl": "15", "post": "Assistant Director (Information)"}, {"gl": "16", "post": "Deputy Director (Information)"}, {"gl": "17", "post": "Director (Information)"}]}, {"name": "Public Relations Cadre", "levels": [{"gl": "08", "post": "Public Relations Officer II"}, {"gl": "09", "post": "Public Relations Officer I"}, {"gl": "10", "post": "Senior Public Relations Officer"}, {"gl": "12", "post": "Principal Public Relations Officer"}, {"gl": "13", "post": "Assistant Chief Public Relations Officer"}, {"gl": "14", "post": "Chief Public Relations Officer"}, {"gl": "15", "post": "Assistant Director (Public Relations)"}, {"gl": "16", "post": "Deputy Director (Public Relations)"}, {"gl": "17", "post": "Director (Public Relations)"}]}, {"name": "Printing Cadre", "levels": [{"gl": "08", "post": "Printer II"}, {"gl": "09", "post": "Printer I"}, {"gl": "10", "post": "Senior Printer"}, {"gl": "12", "post": "Principal Printer"}, {"gl": "13", "post": "Assistant Chief Printer"}, {"gl": "14", "post": "Chief Printer"}, {"gl": "15", "post": "Assistant Director (Printing)"}, {"gl": "16", "post": "Deputy Director (Printing)"}, {"gl": "17", "post": "Director (Printing)"}]}, {"name": "Technical Officer (Civil) Cadre", "levels": [{"gl": "06", "post": "Assistant Technical Officer (Civil)"}, {"gl": "07", "post": "Technical Officer (Civil)"}, {"gl": "08", "post": "Higher Technical Officer (Civil)"}, {"gl": "09", "post": "Senior Technical Officer (Civil)"}, {"gl": "10", "post": "Principal Technical Officer (Civil) II"}, {"gl": "12", "post": "Principal Technical Officer (Civil) I"}, {"gl": "13", "post": "Assistant Chief Technical Officer (Civil)"}, {"gl": "14", "post": "Chief Technical Officer (Civil)"}]}, {"name": "Technical Officer (Mechanical) Cadre", "levels": [{"gl": "06", "post": "Assistant Technical Officer (Mechanical)"}, {"gl": "07", "post": "Technical Officer (Mechanical)"}, {"gl": "08", "post": "Higher Technical Officer (Mechanical)"}, {"gl": "09", "post": "Senior Technical Officer (Mechanical)"}, {"gl": "10", "post": "Principal Technical Officer (Mechanical) II"}, {"gl": "12", "post": "Principal Technical Officer (Mechanical) I"}, {"gl": "13", "post": "Assistant Chief Technical Officer (Mechanical)"}, {"gl": "14", "post": "Chief Technical Officer (Mechanical)"}]}, {"name": "Technical Officer (Electrical) Cadre", "levels": [{"gl": "06", "post": "Assistant Technical Officer (Electrical)"}, {"gl": "07", "post": "Technical Officer (Electrical)"}, {"gl": "08", "post": "Higher Technical Officer (Electrical)"}, {"gl": "09", "post": "Senior Technical Officer (Electrical)"}, {"gl": "10", "post": "Principal Technical Officer (Electrical) II"}, {"gl": "12", "post": "Principal Technical Officer (Electrical) I"}, {"gl": "13", "post": "Assistant Chief Technical Officer (Electrical)"}, {"gl": "14", "post": "Chief Technical Officer (Electrical)"}]}, {"name": "Technical Officer (Town Planning) Cadre", "levels": [{"gl": "06", "post": "Assistant Technical Officer (Town Planning)"}, {"gl": "07", "post": "Technical Officer (Town Planning)"}, {"gl": "08", "post": "Higher Technical Officer (Town Planning)"}, {"gl": "09", "post": "Senior Technical Officer (Town Planning)"}, {"gl": "10", "post": "Principal Technical Officer (Town Planning) II"}, {"gl": "12", "post": "Principal Technical Officer (Town Planning) I"}, {"gl": "13", "post": "Assistant Chief Technical Officer (Town Planning)"}, {"gl": "14", "post": "Chief Technical Officer (Town Planning)"}]}, {"name": "Statistics Cadre (technician)", "levels": [{"gl": "06", "post": "Assistant Statistical Officer"}, {"gl": "07", "post": "Statistical Officer"}, {"gl": "08", "post": "Higher Statistical Officer"}, {"gl": "09", "post": "Senior Statistical Officer"}, {"gl": "10", "post": "Principal Statistical Officer II"}, {"gl": "12", "post": "Principal Statistical Officer I"}, {"gl": "13", "post": "Assistant Chief Statistical Officer"}, {"gl": "14", "post": "Chief Statistical Officer"}]}, {"name": "Youth Development Officer Cadre", "levels": [{"gl": "08", "post": "Youth Development Officer II"}, {"gl": "09", "post": "Youth Development Officer"}, {"gl": "10", "post": "Senior Youth Development Officer"}, {"gl": "12", "post": "Principal Youth Development Officer I"}, {"gl": "13", "post": "Chief Youth Development Officer"}, {"gl": "14", "post": "Assistant Director (Youth Development)"}, {"gl": "15", "post": "Deputy Director (Youth Development)"}, {"gl": "16", "post": "Director (Youth Development)"}]},
/* ---- added cadres ---- */
{"name": "Permanent Secretary Cadre", "levels": [{"gl": "17", "post": "Director (GL 17) — Permanent Secretary selection"}, {"gl": "PS", "post": "Permanent Secretary"}, {"gl": "PS", "post": "Tutor-General / Permanent Secretary (Education District)"}]},
/* Law-enforcement ladders below follow the common Lagos GL pattern; confirm the exact
   post titles against each agency's current Scheme of Service before relying on them. */
{"name": "Traffic Management Officer Cadre (LASTMA)", "levels": [{"gl": "05", "post": "Traffic Assistant"}, {"gl": "06", "post": "Senior Traffic Assistant"}, {"gl": "07", "post": "Assistant Traffic Officer"}, {"gl": "08", "post": "Traffic Officer II"}, {"gl": "09", "post": "Traffic Officer I"}, {"gl": "10", "post": "Senior Traffic Officer"}, {"gl": "12", "post": "Principal Traffic Officer"}, {"gl": "13", "post": "Assistant Chief Traffic Officer"}, {"gl": "14", "post": "Chief Traffic Officer / Deputy Controller (Traffic)"}, {"gl": "15", "post": "Controller (Traffic) / Assistant Director"}, {"gl": "16", "post": "Deputy Director (Traffic Operations)"}, {"gl": "17", "post": "Director (Traffic Operations)"}]},
{"name": "Vehicle Inspection Officer Cadre (VIS)", "levels": [{"gl": "06", "post": "Assistant Vehicle Inspection Officer"}, {"gl": "07", "post": "Vehicle Inspection Officer III"}, {"gl": "08", "post": "Vehicle Inspection Officer II"}, {"gl": "09", "post": "Vehicle Inspection Officer I"}, {"gl": "10", "post": "Senior Vehicle Inspection Officer"}, {"gl": "12", "post": "Principal Vehicle Inspection Officer"}, {"gl": "13", "post": "Assistant Chief Vehicle Inspection Officer"}, {"gl": "14", "post": "Chief Vehicle Inspection Officer"}, {"gl": "15", "post": "Assistant Director (Vehicle Inspection Service)"}, {"gl": "16", "post": "Deputy Director (Vehicle Inspection Service)"}, {"gl": "17", "post": "Director (Vehicle Inspection Service)"}]},
{"name": "Environmental & Special Offences Enforcement Cadre", "levels": [{"gl": "05", "post": "Enforcement Assistant"}, {"gl": "06", "post": "Senior Enforcement Assistant"}, {"gl": "07", "post": "Enforcement Officer II"}, {"gl": "08", "post": "Enforcement Officer I"}, {"gl": "09", "post": "Senior Enforcement Officer"}, {"gl": "10", "post": "Principal Enforcement Officer"}, {"gl": "12", "post": "Assistant Chief Enforcement Officer"}, {"gl": "13", "post": "Chief Enforcement Officer"}, {"gl": "14", "post": "Assistant Director (Enforcement)"}, {"gl": "15", "post": "Deputy Director (Enforcement)"}, {"gl": "16", "post": "Director (Enforcement)"}]},
{"name": "Neighbourhood Safety Corps Cadre (LNSC)", "levels": [{"gl": "04", "post": "Corps Member"}, {"gl": "05", "post": "Senior Corps Member"}, {"gl": "06", "post": "Assistant Safety Officer"}, {"gl": "07", "post": "Safety Officer II"}, {"gl": "08", "post": "Safety Officer I"}, {"gl": "09", "post": "Senior Safety Officer"}, {"gl": "10", "post": "Principal Safety Officer"}, {"gl": "12", "post": "Assistant Chief Safety Officer"}, {"gl": "13", "post": "Chief Safety Officer"}, {"gl": "14", "post": "Assistant Director (Neighbourhood Safety)"}]}
];

/* ============================================================
   BASE QUESTION BANK (COMMON — every cadre sees these)
   ============================================================ */
var SEED_QUESTIONS = [
/* ---------- QUANTITATIVE ---------- */
{scope:"COMMON",category:"Quantitative",type:"mcq",difficulty:"easy",
 stem:"A civil servant earns ₦180,000 per month. If 7.5% is deducted for pension, what is the monthly pension contribution?",
 options:["₦11,500","₦13,500","₦15,000","₦18,000"],answer:1,
 explanation:"7.5% of ₦180,000 = 0.075 × 180,000 = ₦13,500."},
{scope:"COMMON",category:"Quantitative",type:"mcq",difficulty:"medium",
 stem:"A file of 240 pages is shared equally among 8 officers to review. If 3 officers are absent, how many extra pages does each remaining officer review compared with the original plan?",
 options:["18 pages","12 pages","30 pages","10 pages"],answer:0,
 explanation:"Original: 240 ÷ 8 = 30 pages each. With 5 present: 240 ÷ 5 = 48 pages each. Extra = 48 − 30 = 18 pages."},
{scope:"COMMON",category:"Quantitative",type:"mcq",difficulty:"medium",
 stem:"The ratio of male to female staff in a unit is 5:3. If there are 40 staff in total, how many are female?",
 options:["25","15","24","12"],answer:1,
 explanation:"Total ratio parts = 5+3 = 8. Female share = 3/8 × 40 = 15."},
{scope:"COMMON",category:"Quantitative",type:"shortanswer",difficulty:"easy",
 stem:"What is 15% of ₦2,000? (Enter the amount in figures only, e.g. 300)",
 accept:["300","₦300","300.00"],
 explanation:"15% of 2,000 = 0.15 × 2,000 = 300."},
{scope:"COMMON",category:"Quantitative",type:"truefalse",difficulty:"easy",
 stem:"If an item costs ₦4,500 and is sold for ₦5,400, the profit percentage is 20%.",answer:true,
 explanation:"Profit = 5,400 − 4,500 = 900. Profit % = 900/4,500 × 100 = 20%."},
{scope:"COMMON",category:"Quantitative",type:"ordering",difficulty:"medium",
 stem:"Arrange these amounts from SMALLEST to LARGEST.",
 items:["₦45,000","₦120,500","₦340,000","₦1,050,000"],
 explanation:"Ordering by value: 45,000 < 120,500 < 340,000 < 1,050,000."},

/* ---------- QUALITATIVE (verbal reasoning) ---------- */
{scope:"COMMON",category:"Qualitative",type:"mcq",difficulty:"easy",
 stem:"Choose the word most nearly SIMILAR in meaning to: DILIGENT",
 options:["Lazy","Hardworking","Careless","Late"],answer:1,
 explanation:"'Diligent' means showing careful and persistent effort — i.e. hardworking. The others are opposites or unrelated."},
{scope:"COMMON",category:"Qualitative",type:"mcq",difficulty:"medium",
 stem:"Choose the word OPPOSITE in meaning to: TRANSPARENT",
 options:["Clear","Honest","Opaque","Open"],answer:2,
 explanation:"'Transparent' means see-through/clear; its opposite is 'opaque' (not able to be seen through)."},
{scope:"COMMON",category:"Qualitative",type:"mcq",difficulty:"medium",
 stem:"Complete the analogy: Doctor is to Hospital as Teacher is to ___",
 options:["Student","School","Book","Lesson"],answer:1,
 explanation:"A doctor works in a hospital; by the same relationship, a teacher works in a school."},
{scope:"COMMON",category:"Qualitative",type:"mcq",difficulty:"easy",
 stem:"Pick the ODD one out.",
 options:["Circular","Memo","Report","Bicycle"],answer:3,
 explanation:"Circular, memo and report are official written communications; a bicycle is not — it is the odd one out."},
{scope:"COMMON",category:"Qualitative",type:"shortanswer",difficulty:"medium",
 stem:"Give a single word that means 'a formal written request signed by many people'.",
 accept:["petition","a petition"],
 explanation:"A 'petition' is a formal written request, typically signed by many people, appealing to an authority."},
{scope:"COMMON",category:"Qualitative",type:"matching",difficulty:"medium",
 stem:"Match each word to its correct meaning.",
 pairs:[{l:"Concise",r:"Brief and clear"},{l:"Ambiguous",r:"Having more than one meaning"},
        {l:"Redundant",r:"No longer needed / repetitive"},{l:"Impartial",r:"Not favouring one side"}],
 explanation:"Concise = brief and clear; Ambiguous = open to more than one meaning; Redundant = superfluous/repetitive; Impartial = unbiased."},

/* ---------- LOGIC ---------- */
{scope:"COMMON",category:"Logic",type:"mcq",difficulty:"easy",
 stem:"Find the next number in the series: 2, 6, 12, 20, 30, ___",
 options:["36","40","42","44"],answer:2,
 explanation:"Differences increase by 2 each time: +4, +6, +8, +10, then +12 → 30 + 12 = 42."},
{scope:"COMMON",category:"Logic",type:"mcq",difficulty:"medium",
 stem:"If all directors are officers, and some officers are auditors, which statement MUST be true?",
 options:["All auditors are directors","Some directors are auditors","All directors are officers","No officer is an auditor"],answer:2,
 explanation:"Only 'all directors are officers' is guaranteed by the premises. The links to auditors are only 'some', so nothing certain follows about directors and auditors."},
{scope:"COMMON",category:"Logic",type:"mcq",difficulty:"medium",
 stem:"In a code, OFFICE is written as PGGJDF (each letter moved one step forward). How is FILE written in the same code?",
 options:["GJMF","EHKD","GKMF","HJMF"],answer:0,
 explanation:"Shift each letter forward by one: F→G, I→J, L→M, E→F, giving GJMF."},
{scope:"COMMON",category:"Logic",type:"truefalse",difficulty:"medium",
 stem:"Facing North and turning 90° clockwise, then 180° more, you now face West.",answer:true,
 explanation:"North + 90° clockwise = East; East + 180° = West. So you face West."},
{scope:"COMMON",category:"Logic",type:"ordering",difficulty:"easy",
 stem:"Arrange the series in the correct ascending pattern (each term is double the previous): put them in order.",
 items:["3","6","12","24","48"],
 explanation:"Each term doubles: 3, 6, 12, 24, 48."},

/* ---------- ENGLISH & GRAMMAR ---------- */
{scope:"COMMON",category:"English and Grammar",type:"mcq",difficulty:"easy",
 stem:"Choose the correct option: 'Neither the officers nor the director ___ present at the meeting.'",
 options:["were","was","are","been"],answer:1,
 explanation:"With 'neither…nor', the verb agrees with the nearer subject. 'The director' is singular, so 'was' is correct."},
{scope:"COMMON",category:"English and Grammar",type:"mcq",difficulty:"medium",
 stem:"Choose the correctly spelt word.",
 options:["Acknowlegement","Acknowledgement","Acknowlegdement","Aknowledgement"],answer:1,
 explanation:"The correct spelling is 'acknowledgement' (British) — 'acknowledg(e)ment'."},
{scope:"COMMON",category:"English and Grammar",type:"mcq",difficulty:"medium",
 stem:"Fill the gap: 'The report was submitted ___ the Permanent Secretary on Monday.'",
 options:["at","to","in","for"],answer:1,
 explanation:"You submit something 'to' a person. 'To the Permanent Secretary' is the correct collocation."},
{scope:"COMMON",category:"English and Grammar",type:"truefalse",difficulty:"easy",
 stem:"The sentence 'Each of the files have been reviewed' is grammatically correct.",answer:false,
 explanation:"'Each' is singular, so it takes 'has', not 'have': 'Each of the files has been reviewed.'"},
{scope:"COMMON",category:"English and Grammar",type:"shortanswer",difficulty:"easy",
 stem:"Give the plural of the word 'memorandum'.",
 accept:["memoranda","memorandums"],
 explanation:"The Latin-derived plural is 'memoranda'; 'memorandums' is also accepted in modern usage."},
{scope:"COMMON",category:"English and Grammar",type:"matching",difficulty:"medium",
 stem:"Match each word to its correct part of speech.",
 pairs:[{l:"Quickly",r:"Adverb"},{l:"Honesty",r:"Noun"},{l:"Approve",r:"Verb"},{l:"Diligent",r:"Adjective"}],
 explanation:"Quickly = adverb; Honesty = noun; Approve = verb; Diligent = adjective."},

/* ---------- LAGOS STATE CIVIL SERVICE RULES ---------- */
{scope:"COMMON",category:"Lagos State Civil Service Rules",type:"mcq",difficulty:"medium",
 stem:"In the Public Service, an officer compulsorily retires on attaining the age of 60 years OR after how many years of pensionable service, whichever is earlier?",
 options:["30 years","35 years","40 years","25 years"],answer:1,
 explanation:"The general rule in the Nigerian Public Service (adopted by Lagos State) is retirement at 60 years of age or 35 years of pensionable service, whichever comes first."},
{scope:"COMMON",category:"Lagos State Civil Service Rules",type:"mcq",difficulty:"medium",
 stem:"A written demand for an explanation from an officer over an alleged misconduct is called a ___.",
 options:["Warrant","Query","Circular","Voucher"],answer:1,
 explanation:"A 'query' is the formal written request for explanation issued to an officer before any disciplinary decision is taken."},
{scope:"COMMON",category:"Lagos State Civil Service Rules",type:"mcq",difficulty:"hard",
 stem:"The tool used to assess an officer's yearly work performance in the service is known as ___.",
 options:["APER form","Nominal roll","Vote book","Imprest sheet"],answer:0,
 explanation:"APER (Annual Performance Evaluation Report) is the standard instrument for assessing an officer's yearly performance."},
{scope:"COMMON",category:"Lagos State Civil Service Rules",type:"truefalse",difficulty:"medium",
 stem:"Interdiction of an officer means the officer's appointment has been permanently terminated.",answer:false,
 explanation:"Interdiction is a temporary removal from duty (often on part salary) pending investigation — not termination. Permanent removal is 'dismissal'."},
{scope:"COMMON",category:"Lagos State Civil Service Rules",type:"shortanswer",difficulty:"medium",
 stem:"What is the usual probationary period (in years) for a newly appointed pensionable officer? (Enter a number)",
 accept:["2","two"],
 explanation:"A newly appointed officer to a pensionable post normally serves a probationary period of two (2) years before confirmation."},
/* REVISED: the old version ranked Suspension below Interdiction, which inverts the PSR position. */
{scope:"COMMON",category:"Lagos State Civil Service Rules",type:"ordering",difficulty:"hard",
 stem:"Arrange these measures by the severity of their consequence for the officer's pay and status, from LEAST to MOST severe.",
 items:["Query","Warning","Interdiction","Suspension","Dismissal"],
 explanation:"A query only demands an explanation; a warning is the mildest sanction; interdiction removes the officer from duty on not less than half pay while a case is investigated; suspension removes the officer from duty without pay where dismissal or prosecution is in view; dismissal ends the appointment with loss of benefits."},

/* ---------- LAGOS STATE FINANCIAL REGULATIONS ---------- */
{scope:"COMMON",category:"Lagos State Financial Regulations",type:"mcq",difficulty:"medium",
 stem:"The transfer of funds from one approved sub-head of a vote to another is known as ___.",
 options:["Virement","Imprest","Warrant","Surcharge"],answer:0,
 explanation:"'Virement' is the authorised transfer of savings from one sub-head to another within the same vote, subject to approval."},
{scope:"COMMON",category:"Lagos State Financial Regulations",type:"mcq",difficulty:"medium",
 stem:"A fixed sum of money advanced to an officer to meet minor recurring expenses, which is periodically retired and replenished, is called ___.",
 options:["A grant","An imprest","A subvention","A warrant"],answer:1,
 explanation:"An 'imprest' is a fixed cash advance for minor/petty expenses, retired and reimbursed periodically."},
{scope:"COMMON",category:"Lagos State Financial Regulations",type:"mcq",difficulty:"hard",
 stem:"The book in which an officer records, on a vote-by-vote basis, commitments and expenditure to avoid over-spending, is the ___.",
 options:["Cash book","Vote book","Ledger","Nominal roll"],answer:1,
 explanation:"The 'vote book' records commitments and actual expenditure against each vote so that a vote is not exceeded."},
{scope:"COMMON",category:"Lagos State Financial Regulations",type:"truefalse",difficulty:"medium",
 stem:"A 'surcharge' is a personal financial liability imposed on an officer for a loss of public funds caused by his negligence.",answer:true,
 explanation:"A surcharge makes an officer personally liable to make good a loss of public money or stores arising from negligence or misconduct."},
{scope:"COMMON",category:"Lagos State Financial Regulations",type:"shortanswer",difficulty:"medium",
 stem:"What single word describes a document authorising the release of funds from the treasury for spending?",
 accept:["warrant","a warrant"],
 explanation:"A 'warrant' is the authority issued for the release/expenditure of public funds."},
{scope:"COMMON",category:"Lagos State Financial Regulations",type:"matching",difficulty:"hard",
 stem:"Match each financial term to its meaning.",
 pairs:[{l:"Imprest",r:"Fixed advance for petty expenses"},
        {l:"Virement",r:"Transfer between sub-heads of a vote"},
        {l:"Surcharge",r:"Personal liability for a loss"},
        {l:"Vote book",r:"Record of commitments vs expenditure"}],
 explanation:"Imprest = petty-cash advance; Virement = transfer between sub-heads; Surcharge = personal liability for loss; Vote book = record of commitments and expenditure."},

/* ---------- CURRENT AFFAIRS (durable civics — refresh regularly) ---------- */
{scope:"COMMON",category:"Current Affairs",type:"mcq",difficulty:"easy",
 stem:"What is the capital of Lagos State?",
 options:["Lagos Island","Ikeja","Badagry","Epe"],answer:1,
 explanation:"Ikeja is the capital of Lagos State (the state capital moved from Lagos Island to Ikeja)."},
{scope:"COMMON",category:"Current Affairs",type:"mcq",difficulty:"medium",
 stem:"How many Local Government Areas (LGAs) does Lagos State have?",
 options:["16","18","20","22"],answer:2,
 explanation:"Lagos State is made up of 20 constitutionally recognised Local Government Areas."},
{scope:"COMMON",category:"Current Affairs",type:"mcq",difficulty:"medium",
 stem:"Lagos State was created on 27th May in which year?",
 options:["1963","1967","1976","1991"],answer:1,
 explanation:"Lagos State was created on 27 May 1967 under the States (Creation and Transitional Provisions) Decree."},
{scope:"COMMON",category:"Current Affairs",type:"truefalse",difficulty:"easy",
 stem:"The official slogan of Lagos State is 'Centre of Excellence'.",answer:true,
 explanation:"Lagos State's long-standing official slogan is 'Centre of Excellence'."},
{scope:"COMMON",category:"Current Affairs",type:"shortanswer",difficulty:"medium",
 stem:"How many senatorial districts does Lagos State have? (Enter a number)",
 accept:["3","three"],
 explanation:"Lagos State has three (3) senatorial districts: Lagos West, Lagos Central and Lagos East."},
{scope:"COMMON",category:"Current Affairs",type:"mcq",difficulty:"easy",
 stem:"Nigeria's Federal Capital Territory (Abuja) formally became the seat of government in ___.",
 options:["1976","1985","1991","1999"],answer:2,
 explanation:"The Federal Capital was formally moved from Lagos to Abuja in 1991."}
];

/* Patches applied once to databases seeded before these fixes (see Code.gs → applyPatchesV2_). */
var SEED_PATCHES_V2=[
  {matchStem:"Arrange these disciplinary stages in their usual order of severity, from LEAST to MOST severe.",
   set:{stem:"Arrange these measures by the severity of their consequence for the officer's pay and status, from LEAST to MOST severe.",
        items:["Query","Warning","Interdiction","Suspension","Dismissal"],
        explanation:"A query only demands an explanation; a warning is the mildest sanction; interdiction removes the officer from duty on not less than half pay while a case is investigated; suspension removes the officer from duty without pay where dismissal or prosecution is in view; dismissal ends the appointment with loss of benefits."}},
  {matchStem:"Which of the following is a valid IPv4 address?",
   set:{options:["192.168.0.1","256.300.1.1","www.gov.ng","AB:CD:EF"]}}
];

/* ============================================================
   ICT CADRE BANK
   ============================================================ */
var SEED_ICT=(function(){
  var S="Information & Communication Technology (ICT) Cadre",C="ICT",out=[];
  function add(d,type,stem,extra,ex){var q={scope:S,category:C,type:type,stem:stem,explanation:ex,difficulty:d};for(var k in extra)q[k]=extra[k];out.push(q);}
  function mcq(d,stem,o,a,ex){add(d,"mcq",stem,{options:o,answer:a},ex);}
  function tf(d,stem,a,ex){add(d,"truefalse",stem,{answer:a},ex);}
  function sa(d,stem,acc,ex){add(d,"shortanswer",stem,{accept:acc},ex);}
  function ord(d,stem,items,ex){add(d,"ordering",stem,{items:items},ex);}
  function mat(d,stem,pairs,ex){add(d,"matching",stem,{pairs:pairs.map(function(p){return {l:p[0],r:p[1]};})},ex);}

  mcq("easy","What does CPU stand for?",["Central Processing Unit","Computer Personal Unit","Central Program Utility","Control Processing Union"],0,"The CPU (Central Processing Unit) executes instructions and is the 'brain' of the computer.");
  mcq("easy","Which component is regarded as the 'brain' of the computer?",["Hard disk","Monitor","CPU","Power supply"],2,"The CPU carries out the processing of instructions.");
  mcq("easy","How many bits make up one byte?",["4","8","16","1024"],1,"A byte is a group of 8 bits.");
  mcq("easy","Which of these is a volatile memory that loses its contents when power is off?",["ROM","RAM","Hard disk","Flash drive"],1,"RAM (Random Access Memory) is volatile; its contents are lost when power is removed.");
  mcq("medium","ROM is best described as memory that is:",["Volatile and writable","Non-volatile and mainly read-only","Only found on the internet","The same as RAM"],1,"ROM (Read-Only Memory) retains data without power and is primarily read-only.");
  mcq("easy","Which of the following is an INPUT device?",["Monitor","Printer","Keyboard","Speaker"],2,"A keyboard feeds data into the computer, so it is an input device.");
  mcq("easy","Which of the following is an OUTPUT device?",["Mouse","Scanner","Microphone","Printer"],3,"A printer produces output (hard copy) from the computer.");
  mcq("easy","Which of these is primarily a STORAGE device?",["Hard disk drive","Keyboard","Monitor","Mouse"],0,"A hard disk drive stores data permanently.");
  mcq("easy","The physical, tangible parts of a computer are collectively called:",["Software","Hardware","Firmware","Malware"],1,"Hardware refers to the physical components you can touch.");
  mcq("easy","Which unit is the LARGEST?",["Kilobyte","Megabyte","Gigabyte","Terabyte"],3,"Order (small→large): KB, MB, GB, TB.");
  mcq("medium","Approximately how many bytes are in one kilobyte (KB)?",["8","100","1024","1,000,000"],2,"1 KB = 1024 bytes (2^10).");
  mcq("medium","How many distinct values can a single byte represent?",["8","16","128","256"],3,"8 bits give 2^8 = 256 possible values.");
  mcq("easy","The binary number system uses only the digits:",["0 to 9","0 and 1","1 to 8","0 to 7"],1,"Binary is base-2 and uses only 0 and 1.");
  mcq("medium","The decimal number 10 in binary is:",["1000","1010","1100","1001"],1,"10 = 8 + 2 = 1010 in binary.");
  mcq("medium","The binary number 1111 equals which decimal value?",["7","14","15","16"],2,"1111 = 8+4+2+1 = 15.");
  mcq("medium","Hexadecimal is a number system of base:",["2","8","10","16"],3,"Hexadecimal is base-16 (digits 0–9 and A–F).");
  mcq("medium","In hexadecimal, the letter A represents which decimal value?",["10","11","15","16"],0,"Hex A = decimal 10.");
  mcq("easy","An operating system is best described as:",["Application software for typing","System software that manages hardware and other software","A type of computer virus","A web browser"],1,"The OS manages hardware resources and runs application software.");
  mcq("easy","Which of the following is an operating system?",["Microsoft Word","Microsoft Excel","Microsoft Windows","Google Chrome"],2,"Windows is an operating system; the others are applications.");
  mcq("easy","Which of the following is APPLICATION software?",["Windows","Linux","Microsoft Word","Android OS"],2,"MS Word is application software; the others are operating systems.");
  mcq("easy","'Booting' a computer means:",["Kicking the system unit","Starting it up and loading the operating system","Deleting all files","Connecting to the internet"],1,"Booting is the start-up process that loads the OS into memory.");
  mcq("easy","Which key combination is commonly used to open the security screen / Task Manager options in Windows?",["Ctrl + C","Ctrl + Alt + Del","Alt + Tab","Ctrl + P"],1,"Ctrl+Alt+Del opens the Windows security screen with Task Manager access.");
  mcq("easy","In Microsoft Excel, every formula must begin with which symbol?",["+","#","=","@"],2,"Excel formulas start with an equals sign, e.g. =SUM(A1:A5).");
  mcq("easy","Which Excel function adds up a range of numbers?",["AVERAGE","SUM","COUNT","MAX"],1,"SUM totals the values in a range.");
  mcq("easy","In Excel, =AVERAGE(A1:A10) returns:",["The largest value","The mean of the values","The number of cells","The smallest value"],1,"AVERAGE returns the arithmetic mean.");
  mcq("easy","In a spreadsheet, the box formed where a row and a column meet is called a:",["Range","Cell","Sheet","Field"],1,"A cell is the intersection of a row and a column.");
  mcq("easy","Microsoft PowerPoint is mainly used to create:",["Spreadsheets","Databases","Presentations / slides","Web servers"],2,"PowerPoint is presentation software.");
  mcq("easy","Which file extension normally belongs to a Microsoft Word document?",[".xlsx",".docx",".pptx",".mp4"],1,".docx is the Word document format.");
  mcq("easy","Which file extension normally belongs to a Microsoft Excel workbook?",[".docx",".xlsx",".pdf",".txt"],1,".xlsx is the Excel workbook format.");
  mcq("easy","The keyboard shortcut to COPY selected content in Windows is:",["Ctrl + X","Ctrl + C","Ctrl + V","Ctrl + Z"],1,"Ctrl+C copies the selection to the clipboard.");
  mcq("easy","The keyboard shortcut to PASTE content in Windows is:",["Ctrl + P","Ctrl + V","Ctrl + B","Ctrl + S"],1,"Ctrl+V pastes clipboard content.");
  mcq("easy","The keyboard shortcut to SAVE the current document is:",["Ctrl + S","Ctrl + D","Ctrl + N","Ctrl + O"],0,"Ctrl+S saves the document.");
  mcq("easy","The keyboard shortcut to UNDO the last action is:",["Ctrl + Y","Ctrl + U","Ctrl + Z","Ctrl + A"],2,"Ctrl+Z undoes the last action.");
  mcq("medium","A collection of related data organised in rows and columns in a database is called a:",["Query","Table","Macro","Cell"],1,"Data in a relational database is stored in tables (rows and columns).");
  mcq("medium","A column in a database table is also known as a:",["Record","Field","Query","Report"],1,"A field (column) holds one attribute; a record (row) holds one entry.");
  mcq("medium","The field that uniquely identifies each record in a table is the:",["Foreign key","Primary key","Index key","Sort key"],1,"A primary key uniquely identifies each record.");
  mcq("medium","SQL stands for:",["Simple Query Language","Structured Query Language","System Query Logic","Sequential Question Language"],1,"SQL = Structured Query Language, used to manage relational databases.");
  mcq("medium","Which SQL statement is used to RETRIEVE data from a database?",["INSERT","SELECT","DELETE","UPDATE"],1,"SELECT retrieves rows from tables.");
  mcq("medium","DBMS stands for:",["Data Backup Management System","Database Management System","Digital Business Mail Service","Distributed Base Memory Store"],1,"A DBMS is software for creating and managing databases (e.g. MySQL, Access).");
  mcq("easy","A network that covers a single office or building is a:",["WAN","LAN","MAN","VPN"],1,"A LAN (Local Area Network) covers a small area such as one building.");
  mcq("easy","A network that spans cities or countries is a:",["LAN","PAN","WAN","NIC"],2,"A WAN (Wide Area Network) covers large geographic areas.");
  mcq("medium","Which device connects different networks and routes traffic between them?",["Switch","Router","Printer","Scanner"],1,"A router forwards data between networks and finds the best path.");
  mcq("easy","IP (as in 'IP address') stands for:",["Internet Provider","Internet Protocol","Internal Path","Information Point"],1,"IP = Internet Protocol; an IP address identifies a device on a network.");
  mcq("medium","The Domain Name System (DNS) is responsible for:",["Encrypting passwords","Translating domain names into IP addresses","Printing documents","Compressing files"],1,"DNS resolves human-readable names (e.g. lagosstate.gov.ng) to IP addresses.");
  mcq("medium","HTTP is a protocol used mainly for:",["Sending printed mail","Transferring web pages","Managing databases","Backing up disks"],1,"HTTP (HyperText Transfer Protocol) transfers web content.");
  mcq("easy","The 's' in HTTPS indicates that the connection is:",["Slower","Secure (encrypted)","Shared","Simple"],1,"HTTPS adds encryption (TLS/SSL) for secure communication.");
  /* FIXED: option 3 had been corrupted into a Markdown link by a copy-paste. */
  mcq("medium","Which of the following is a valid IPv4 address?",["192.168.0.1","256.300.1.1","www.gov.ng","AB:CD:EF"],0,"IPv4 addresses have four numbers (0–255) separated by dots.");
  mcq("easy","WWW stands for:",["World Wide Web","Wide Web World","Web Within Windows","World Web Wire"],0,"WWW = World Wide Web.");
  mcq("easy","A program used to access and view websites is called a:",["Compiler","Web browser","Spreadsheet","Firewall"],1,"Browsers (Chrome, Edge, Firefox) display web pages.");
  mcq("medium","Cloud computing mainly refers to:",["Storing files only on a local hard disk","Delivering computing services over the internet","A weather-forecasting program","A type of printer"],1,"Cloud computing provides storage, servers and apps over the internet on demand.");
  mcq("easy","Which of the following is an example of cloud storage?",["Google Drive","Notepad","Recycle Bin","BIOS"],0,"Google Drive stores files on internet-based servers.");
  mcq("easy","Malicious software such as viruses, worms and trojans is collectively called:",["Freeware","Malware","Firmware","Shareware"],1,"Malware = malicious software designed to harm or exploit systems.");
  mcq("medium","A fraudulent attempt to obtain passwords by pretending to be a trustworthy party (often by email) is called:",["Phishing","Caching","Pinging","Formatting"],0,"Phishing tricks users into revealing credentials or clicking malicious links.");
  mcq("medium","A firewall is used mainly to:",["Cool the computer","Control and filter network traffic for security","Increase storage space","Design web pages"],1,"A firewall monitors and filters traffic to block unauthorised access.");
  mcq("medium","Converting data into an unreadable form so only authorised parties can read it is called:",["Compression","Encryption","Formatting","Defragmentation"],1,"Encryption scrambles data so only those with the key can read it.");
  mcq("easy","Which is the STRONGEST password practice?",["Using 'password123'","Using your name and year of birth","Using a long mix of upper/lowercase letters, numbers and symbols","Using '1234'"],2,"Long, complex, unique passwords are hardest to guess or crack.");
  mcq("medium","2FA (as in account security) stands for:",["Two-File Access","Two-Factor Authentication","Twice-Failed Attempt","Two-Field Application"],1,"2FA adds a second verification step beyond the password.");
  mcq("easy","Regularly keeping spare copies of data so it can be recovered after loss is called:",["Backup","Booting","Browsing","Buffering"],0,"Backups protect against data loss from failure, theft or attack.");
  mcq("easy","Software designed to detect and remove viruses is called:",["Antivirus","Spreadsheet","Compiler","Browser"],0,"Antivirus software detects, quarantines and removes malware.");
  mcq("medium","An algorithm is best defined as:",["A computer virus","A step-by-step procedure for solving a problem","A type of monitor","A storage device"],1,"An algorithm is an ordered set of steps to solve a problem.");
  mcq("medium","A flowchart is:",["A diagrammatic representation of the steps in a process or algorithm","A spreadsheet formula","A network cable","A printer setting"],0,"Flowcharts show process logic using standard symbols.");
  mcq("medium","In a flowchart, the diamond shape represents a:",["Process","Decision","Start/Stop","Input"],1,"The diamond denotes a decision (yes/no) point.");
  mcq("easy","Which of the following is a programming language?",["Python","Windows","Ethernet","HTTP"],0,"Python is a popular programming language.");
  mcq("medium","HTML is used mainly to:",["Structure and format web pages","Manage a database","Cool the processor","Connect to Wi-Fi"],0,"HTML (HyperText Markup Language) defines the structure of web pages.");
  mcq("medium","The expression 'GIGO' in computing means:",["Great In, Great Out","Garbage In, Garbage Out","Global Internet, Global Output","Get In, Get Out"],1,"GIGO: poor-quality input produces poor-quality output.");
  mcq("medium","e-Government refers to:",["Using ICT to deliver government services and information","A political party","A type of computer virus","A printing press"],0,"e-Government uses ICT to improve service delivery and transparency.");
  mcq("hard","In Nigeria, the principal law governing the protection of personal data is the:",["Freedom of Information Act","Nigeria Data Protection Act (2023)","Cybercafe Act","Broadcasting Code"],1,"The Nigeria Data Protection Act 2023 (building on the NDPR) governs personal data.");
  mcq("medium","Keeping citizens' personal records private and disclosing them only to authorised persons is the principle of:",["Redundancy","Confidentiality","Compression","Duplication"],1,"Confidentiality ensures data is accessible only to those authorised.");
  mcq("medium","Which practice best protects official data against ransomware or disk failure?",["Never turning the PC off","Keeping regular, separate backups","Sharing the admin password widely","Disabling the antivirus"],1,"Separate, regular backups allow recovery without paying ransom or losing work.");
  tf("easy","RAM retains its contents even when the computer is switched off.",false,"RAM is volatile — its contents are lost when power is removed.");
  tf("easy","HTTPS encrypts data exchanged between a browser and a website.",true,"The 's' in HTTPS means the connection is secured with encryption.");
  tf("easy","A primary key in a database table may contain duplicate values.",false,"A primary key must be unique for every record.");
  tf("easy","Ctrl + P is commonly used to print a document.",true,"Ctrl+P opens the print dialog in most applications.");
  tf("easy","Open public Wi-Fi is always safe for entering passwords and banking details.",false,"Open Wi-Fi can be intercepted; avoid sensitive transactions or use a VPN.");
  tf("easy","The OSI reference model is made up of seven layers.",true,"The OSI model has 7 layers, from Physical to Application.");
  tf("easy","A megabyte (MB) is larger than a gigabyte (GB).",false,"A gigabyte is larger: 1 GB = 1024 MB.");
  tf("easy","Phishing is a form of social-engineering attack.",true,"Phishing manipulates people into revealing information — a social-engineering method.");
  tf("easy","Storing your only backup on the same disk as the original data is good practice.",false,"If that disk fails, both original and backup are lost; keep backups separate.");
  tf("easy","A switch is generally used to connect devices within the same local network.",true,"A switch connects and forwards frames between devices on a LAN.");
  sa("easy","Expand the abbreviation 'CPU'.",["central processing unit"],"CPU = Central Processing Unit.");
  sa("easy","Expand the abbreviation 'RAM'.",["random access memory"],"RAM = Random Access Memory.");
  sa("easy","Expand the abbreviation 'URL'.",["uniform resource locator"],"URL = Uniform Resource Locator (a web address).");
  sa("easy","How many bits are there in one byte? (give the number)",["8","eight"],"One byte = 8 bits.");
  sa("easy","In Excel, which single symbol must every formula start with?",["=","equals","equal sign","equals sign"],"Every Excel formula begins with '='.");
  sa("easy","Expand the abbreviation 'PDF'.",["portable document format"],"PDF = Portable Document Format.");
  sa("easy","Expand the abbreviation 'VPN'.",["virtual private network"],"VPN = Virtual Private Network.");
  sa("easy","Which SQL keyword is used to retrieve records from a table?",["select"],"SELECT retrieves data in SQL.");
  ord("medium","Arrange these units of data storage from SMALLEST to LARGEST.",["Bit","Byte","Kilobyte","Megabyte","Gigabyte","Terabyte"],"Order: Bit < Byte < Kilobyte < Megabyte < Gigabyte < Terabyte.");
  ord("medium","Put the basic steps of sending an email in the correct order.",["Open your email and click Compose","Enter the recipient's address","Type the subject","Write the message","Click Send"],"Compose → add recipient → subject → body → Send.");
  ord("medium","Arrange these stages of the software development life cycle in the usual order.",["Requirements analysis","Design","Coding","Testing","Deployment"],"A common SDLC order: analyse, design, code, test, then deploy.");
  mat("medium","Match each acronym to its correct meaning.",[["CPU","Central Processing Unit"],["RAM","Random Access Memory"],["LAN","Local Area Network"],["DNS","Domain Name System"]],"CPU=Central Processing Unit; RAM=Random Access Memory; LAN=Local Area Network; DNS=Domain Name System.");
  mat("medium","Match each device to its primary function.",[["Router","Connects and routes traffic between networks"],["Printer","Produces hard-copy output"],["Scanner","Digitises paper documents"],["Monitor","Displays visual output"]],"Each device maps to its main role in a computer system.");
  mat("medium","Match each keyboard shortcut to the action it performs (Windows).",[["Ctrl + C","Copy"],["Ctrl + V","Paste"],["Ctrl + Z","Undo"],["Ctrl + S","Save"]],"Standard Windows editing shortcuts.");
  return out;
})();

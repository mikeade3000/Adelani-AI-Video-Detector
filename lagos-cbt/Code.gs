/* ============================================================
   CBT Platform — Google Apps Script backend
   Deploy as a Web App (Execute as: Me; Who has access: Anyone).
   Bind this script to a Google Sheet (Extensions > Apps Script).

   The project needs FOUR script files:
     Code.gs                      (this file)
     cbt-shared.gs                (contents of cbt-shared.js)
     cbt-bank-permsec.gs          (contents of cbt-bank-permsec.js)
     cbt-bank-law-enforcement.gs  (contents of cbt-bank-law-enforcement.js)

   The sheet tabs (Accounts, Users, Questions, Attempts, Sessions,
   Config) are created and seeded automatically on first request. New
   question banks are added to an existing database once, without
   touching questions that are already there.
   ============================================================ */

/* PEPPER: a server-side secret mixed into every password hash.
   Prefer storing it as a Script Property named PEPPER (Project Settings ▸
   Script properties) so it is not visible in source control. If you already
   have accounts, set that property to EXACTLY the value below, or every
   stored password stops working (use resetSuperAdmin to recover). */
var PEPPER_FALLBACK="cbt::change-this-secret::9f3a7";
var SESSION_TTL_MS=1000*60*60*24*30;   // sessions expire after 30 days
var MIN_PASSWORD=8;
var MAX_LOGIN_FAILS=8,LOGIN_LOCK_SECS=15*60;
var MAX_EXAM_LENGTH=150;               // keeps an attempt well under the 50,000-char cell limit
var DEFAULT_AI_MODEL="claude-opus-5-5";
var SHEETS=["Accounts","Users","Questions","Attempts","Sessions","Config"];

function pepper_(){
  try{var p=PropertiesService.getScriptProperties().getProperty("PEPPER");if(p)return p;}catch(e){}
  return PEPPER_FALLBACK;
}

/* ---- hashing / tokens ---- */
function hash(s){var h=5381;for(var i=0;i<s.length;i++){h=((h<<5)+h)+s.charCodeAt(i);h|=0;}return "h"+(h>>>0).toString(36);} // legacy (djb2) — kept for migration
function uid(p){return (p||"id")+Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-3);}
function sha256b64(s){return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s)));}
function makePass(plain){var salt=String(Utilities.getUuid()).replace(/-/g,"");return {passHash:sha256b64(salt+":"+String(plain)+":"+pepper_()),salt:salt};}
function verifyPass(rec,plain){
  if(rec&&rec.salt)return {ok:rec.passHash===sha256b64(rec.salt+":"+String(plain)+":"+pepper_()),legacy:false};
  return {ok:!!rec&&rec.passHash===hash(String(plain)),legacy:true};   // legacy djb2 record
}
function newToken(){return "tok"+String(Utilities.getUuid()).replace(/-/g,"");}
function pwError_(p){return (typeof p==="string"&&p.length>=MIN_PASSWORD)?null:"Password must be at least "+MIN_PASSWORD+" characters";}

/* ---- shared helpers ---- */
function sanitize(rec,role,kind){var c={};for(var k in rec)c[k]=rec[k];delete c.passHash;delete c.salt;if(role)c.role=role;if(kind)c.kind=kind;return c;}
function publicConfig(cfg,role){
  if(role==="user")return {examLength:cfg.examLength,durationMins:cfg.durationMins};
  if(role==="admin"){var c={};for(var k in cfg)c[k]=cfg[k];delete c.aiKey;return c;}   // never expose the API key to admins
  return cfg;   // super
}
function deny(){return {ok:false,error:"Not permitted"};}
function findRec(store,name,id){
  if(store.find){var r=store.find(name,id);if(r)return r;}
  var a=store.readAll(name);for(var i=0;i<a.length;i++)if(a[i].id===id)return a[i];return null;
}
function setupDone(store){
  if(store.getConfig().setupAck)return true;
  var accs=store.readAll("Accounts"),usrs=store.readAll("Users"),superMust=false;
  for(var i=0;i<accs.length;i++){if(accs[i].role==="super"&&accs[i].mustChange){superMust=true;break;}}
  return (!superMust)||accs.length>1||usrs.length>0;
}
function usernameTaken(store,username){
  var u=String(username||"").toLowerCase(),a=store.readAll("Accounts"),b=store.readAll("Users"),i;
  for(i=0;i<a.length;i++)if(String(a[i].username||"").toLowerCase()===u)return true;
  for(i=0;i<b.length;i++)if(String(b[i].username||"").toLowerCase()===u)return true;
  return false;
}
function pick_(src,fields){var o={};fields.forEach(function(f){if(src[f]!==undefined)o[f]=src[f];});return o;}
function idTaken_(store,id){return !!(findRec(store,"Accounts",id)||findRec(store,"Users",id));}
function freshId_(store,id,prefix){
  return (typeof id==="string"&&/^[A-Za-z0-9_-]{4,64}$/.test(id)&&!idTaken_(store,id))?id:uid(prefix);
}
function appendMany_(store,name,recs){
  if(!recs.length)return;
  if(store.appendMany)store.appendMany(name,recs);else recs.forEach(function(r){store.append(name,r);});
}
function validCadre_(cadre,post){
  if(cadre==null)return true;                       // "not set" is allowed
  var c=(typeof findCadre==="function")?findCadre(cadre):null;
  if(!c)return false;
  if(post==null||post==="")return true;
  return c.levels.some(function(l){return l.post===post;});
}

/* ---- question validation (staff uploads) ---- */
var Q_TYPES={mcq:1,truefalse:1,shortanswer:1,ordering:1,matching:1};
function cleanQuestion_(r){
  if(!r||typeof r!=="object"||!Q_TYPES[r.type])return null;
  var q={id:r.id,scope:String(r.scope||"COMMON"),category:String(r.category||"").trim(),type:r.type,
    difficulty:(["easy","medium","hard"].indexOf(r.difficulty)>=0?r.difficulty:"medium"),
    stem:String(r.stem||"").trim(),explanation:String(r.explanation||"")};
  if(!q.stem||!q.category)return null;
  function strs(a){return Array.isArray(a)?a.map(function(x){return String(x).trim();}).filter(Boolean):[];}
  if(q.type==="mcq"){
    q.options=strs(r.options);var a=Number(r.answer);
    if(q.options.length<2||!(a>=0&&a<q.options.length&&Math.floor(a)===a))return null;q.answer=a;
  }else if(q.type==="truefalse"){q.answer=(r.answer===true||r.answer==="true");}
  else if(q.type==="shortanswer"){q.accept=strs(r.accept);if(!q.accept.length)return null;}
  else if(q.type==="ordering"){q.items=strs(r.items);if(q.items.length<2)return null;}
  else{
    q.pairs=(Array.isArray(r.pairs)?r.pairs:[]).map(function(p){return {l:String((p&&p.l)||"").trim(),r:String((p&&p.r)||"").trim()};})
      .filter(function(p){return p.l&&p.r;});
    if(!q.pairs.length)return null;
  }
  return q;
}

/* ---- one-time seed (idempotent, flag-gated fast path) ---- */
function bankDone_(cfg,b){return !!(cfg["seeded_"+b.key]||(b.legacyFlag&&cfg[b.legacyFlag]));}
function seedComplete_(cfg){
  if(!(cfg.superSeeded&&cfg.baseSeeded&&cfg.seeded&&cfg.patchV2))return false;
  var banks=getSeedBanks();
  for(var i=0;i<banks.length;i++)if(!bankDone_(cfg,banks[i]))return false;
  return true;
}
function withIds_(list){return list.map(function(q){var r={};for(var k in q)r[k]=q[k];r.id=uid("q");return r;});}
function ensureSeed(store){
  var cfg=store.getConfig();
  if(seedComplete_(cfg))return;
  if(!cfg.superSeeded){
    if(store.readAll("Accounts").length===0&&store.readAll("Users").length===0){
      var mp=makePass("changeme123");
      store.append("Accounts",{id:"acc_super",role:"super",username:"superadmin",
        passHash:mp.passHash,salt:mp.salt,name:"System Super Admin",createdAt:Date.now(),mustChange:true});
    }
    store.setConfig({superSeeded:true});
  }
  if(!cfg.baseSeeded){
    if(store.readAll("Questions").length===0)appendMany_(store,"Questions",withIds_(SEED_QUESTIONS));
    store.setConfig({baseSeeded:true});
  }
  if(!cfg.seeded)store.setConfig({seeded:true,examLength:20,durationMins:30,aiProvider:"anthropic",aiModel:DEFAULT_AI_MODEL,aiKey:""});
  var qs=null;
  getSeedBanks().forEach(function(b){
    if(bankDone_(cfg,b))return;
    qs=qs||store.readAll("Questions");
    var has=qs.some(function(q){return q.scope===b.scope;});
    if(!has)appendMany_(store,"Questions",withIds_(b.data));
    var flag={};flag["seeded_"+b.key]=true;store.setConfig(flag);
  });
  if(!cfg.patchV2){applyPatchesV2_(store);store.setConfig({patchV2:true});}
}
/* Fixes two seed questions that were wrong in databases created before this release. */
function applyPatchesV2_(store){
  if(typeof SEED_PATCHES_V2==="undefined")return;
  store.readAll("Questions").forEach(function(q){
    SEED_PATCHES_V2.forEach(function(p){if(q.stem===p.matchStem)store.update("Questions",q.id,p.set);});
  });
}

/* ---- login throttling (per username, via CacheService) ---- */
function cache_(){try{return CacheService.getScriptCache();}catch(e){return null;}}
function failKey_(u){return "lf_"+String(u).slice(0,200);}

/* ---- auth ---- */
function login(store,body){
  var u=String(body.username||"").trim().toLowerCase(),p=String(body.password||"");
  if(!u||!p)return {ok:false,error:"Missing credentials"};
  var c=cache_(),fails=c?Number(c.get(failKey_(u))||0):0;
  if(fails>=MAX_LOGIN_FAILS)return {ok:false,error:"Too many failed attempts. Wait 15 minutes and try again."};
  var accs=store.readAll("Accounts"),usrs=store.readAll("Users"),acc=null,usr=null,i;
  for(i=0;i<accs.length;i++){if(String(accs[i].username||"").toLowerCase()===u){acc=accs[i];break;}}
  for(i=0;i<usrs.length;i++){if(String(usrs[i].username||"").toLowerCase()===u){usr=usrs[i];break;}}
  var found=acc||usr;
  var v=verifyPass(found,p);
  if(!found||!v.ok){if(c)c.put(failKey_(u),String(fails+1),LOGIN_LOCK_SECS);return {ok:false,error:"Incorrect username or password"};}
  if(c)c.remove(failKey_(u));
  if(v.legacy){var up=makePass(p);store.update(acc?"Accounts":"Users",found.id,{passHash:up.passHash,salt:up.salt});} // migrate djb2 → salted on first successful login
  var kind=acc?"staff":"user",role=acc?found.role:"user",token=newToken();
  store.append("Sessions",{id:token,actorId:found.id,kind:kind,role:role,ts:Date.now()});
  if(role==="super"&&!store.getConfig().setupAck)store.setConfig({setupAck:true});
  return {ok:true,token:token,role:role,actor:sanitize(found,role,kind)};
}
function sessionOf(store,token){
  if(!token)return null;
  var s=store.find?store.find("Sessions",token):null;
  if(!s){var ss=store.readAll("Sessions");for(var i=0;i<ss.length;i++){if(ss[i].id===token){s=ss[i];break;}}}
  if(!s)return null;
  if(s.ts&&(Date.now()-s.ts)>SESSION_TTL_MS)return null;   // expired
  return s;
}
function actorOf(store,sess){
  if(!sess)return null;var name=sess.kind==="staff"?"Accounts":"Users",rec=findRec(store,name,sess.actorId),k,o;
  if(!rec)return null;o={};for(k in rec)o[k]=rec[k];o.kind=sess.kind;if(sess.kind!=="staff")o.role="user";return o;
}

/* ---- role-scoped snapshot ---- */
function bootstrap(store,actor,role){
  var config=publicConfig(store.getConfig(),role);
  if(role==="super"){
    return {ok:true,role:role,actor:sanitize(actor,role,actor.kind),
      accounts:store.readAll("Accounts").map(function(a){return sanitize(a);}),
      users:store.readAll("Users").map(function(u){return sanitize(u);}),
      questions:store.readAll("Questions"),attempts:store.readAll("Attempts"),config:config};
  }
  if(role==="admin"){
    var users=store.readAll("Users").filter(function(u){return u.createdBy===actor.id;});
    var uids={};users.forEach(function(u){uids[u.id]=1;});
    return {ok:true,role:role,actor:sanitize(actor,role,actor.kind),
      accounts:[sanitize(actor)],users:users.map(function(u){return sanitize(u);}),
      questions:store.readAll("Questions"),
      attempts:store.readAll("Attempts").filter(function(a){return uids[a.userId];}),config:config};
  }
  var me=findRec(store,"Users",actor.id);var cadre=me&&me.cadre;
  var questions=store.readAll("Questions").filter(function(q){return scopeVisibleTo(q.scope,cadre);});
  return {ok:true,role:"user",actor:sanitize(me||actor,"user","user"),
    accounts:[],users:[sanitize(me||actor)],questions:questions,
    attempts:store.readAll("Attempts").filter(function(a){return a.userId===actor.id;}),config:config};
}

/* ---- request router (permission + field-whitelist checked) ---- */
function handleRequest(store,body){
  var action=body.action;
  if(action==="ping")return {ok:true,ts:Date.now()};
  if(action==="status")return {ok:true,setupDone:setupDone(store)};
  if(action==="login")return login(store,body);
  var sess=sessionOf(store,body.token),actor=actorOf(store,sess);
  if(!actor)return {ok:false,error:"auth"};
  var role=actor.kind==="staff"?actor.role:"user";
  /* A staff account flagged mustChange may only change its own password, load its data, or log out. */
  if(actor.kind==="staff"&&actor.mustChange&&["bootstrap","updateAccount","logout"].indexOf(action)<0)
    return {ok:false,error:"You must change your password before continuing"};
  switch(action){
    case "bootstrap": return bootstrap(store,actor,role);
    case "logout": { store.remove("Sessions",body.token); return {ok:true}; }

    case "addQuestions": {
      if(role==="user")return deny();
      var recs=Array.isArray(body.recs)?body.recs:[],seenIds={},accepted=0,rejected=0;
      store.readAll("Questions").forEach(function(q){seenIds[q.id]=1;});
      var clean=[];
      recs.forEach(function(r){
        var q=cleanQuestion_(r);if(!q){rejected++;return;}
        if(typeof q.id!=="string"||!/^q[\w-]{4,40}$/.test(q.id)||seenIds[q.id])q.id=uid("q");
        seenIds[q.id]=1;clean.push(q);accepted++;
      });
      appendMany_(store,"Questions",clean);
      return {ok:true,count:accepted,rejected:rejected,ids:clean.map(function(q){return q.id;})};
    }
    case "deleteQuestion": { if(role==="user")return deny(); store.remove("Questions",body.id); return {ok:true}; }

    case "createAccount": {
      if(role!=="super")return deny();
      var src=body.rec||{}; if(usernameTaken(store,src.username))return {ok:false,error:"That username is taken"};
      var perr=pwError_(body.password); if(perr)return {ok:false,error:perr};
      var arec=pick_(src,["username","name","createdAt"]);
      arec.username=String(arec.username||"").trim(); if(!arec.username)return {ok:false,error:"Username is required"};
      arec.id=freshId_(store,src.id,"acc"); arec.role="admin"; arec.mustChange=true;   // super creates admins only; admins pick their own password
      arec.createdAt=Number(arec.createdAt)||Date.now();
      var amp=makePass(String(body.password)); arec.passHash=amp.passHash; arec.salt=amp.salt;
      store.append("Accounts",arec); return {ok:true,id:arec.id};
    }
    case "updateAccount": {
      var self=actor.id===body.id;
      if(role!=="super"&&!self)return deny();
      var tgtAcc=findRec(store,"Accounts",body.id); if(!tgtAcc)return {ok:false,error:"Account not found"};
      var apatch=body.patch||{}, aclean={};
      /* Only a super admin can set name/mustChange on OTHER accounts; nobody can clear their own mustChange without a new password. */
      var aAllow=(role==="super")?(self?["name"]:["name","mustChange"]):[];
      for(var ak in apatch){if(aAllow.indexOf(ak)>=0)aclean[ak]=apatch[ak];}
      if(actor.mustChange&&!body.password)return {ok:false,error:"You must change your password before continuing"};
      if(body.password){
        var perr2=pwError_(body.password); if(perr2)return {ok:false,error:perr2};
        var amp2=makePass(String(body.password));aclean.passHash=amp2.passHash;aclean.salt=amp2.salt;aclean.mustChange=!self&&role==="super";
      }
      if(Object.keys(aclean).length)store.update("Accounts",body.id,aclean);
      return {ok:true};
    }
    case "deleteAccount": {
      if(role!=="super")return deny();
      if(body.id===actor.id)return {ok:false,error:"You cannot delete your own account"};
      var dacc=findRec(store,"Accounts",body.id);
      if(dacc&&dacc.role==="super")return {ok:false,error:"A super admin account cannot be deleted here"};
      store.remove("Accounts",body.id); return {ok:true};
    }

    case "createUser": {
      if(role==="user")return deny();
      var usrc=body.rec||{}; if(usernameTaken(store,usrc.username))return {ok:false,error:"That username is taken"};
      var perr3=pwError_(body.password); if(perr3)return {ok:false,error:perr3};
      var urec=pick_(usrc,["username","name","createdAt","cadre","targetPost","cadreLocked","attemptsAllocated","createdBy"]);
      urec.username=String(urec.username||"").trim(); if(!urec.username)return {ok:false,error:"Username is required"};
      if(!validCadre_(urec.cadre||null,urec.targetPost))return {ok:false,error:"Unknown cadre or post"};
      urec.id=freshId_(store,usrc.id,"usr");
      urec.attemptsAllocated=Math.max(0,Math.floor(Number(urec.attemptsAllocated)||0));
      urec.cadreLocked=!!urec.cadre&&!!urec.cadreLocked; urec.createdAt=Number(urec.createdAt)||Date.now();
      if(role==="admin")urec.createdBy=actor.id;   // admins can only create under themselves
      var ump=makePass(String(body.password)); urec.passHash=ump.passHash; urec.salt=ump.salt;
      store.append("Users",urec); return {ok:true,id:urec.id};
    }
    case "updateUser": {
      var target=findRec(store,"Users",body.id); if(!target)return {ok:false,error:"User not found"};
      var upatch=body.patch||{}, uclean={};
      if(role==="user"){
        if(actor.id!==body.id)return deny();
        if(!target.cadreLocked&&(upatch.cadre!==undefined||upatch.targetPost!==undefined||upatch.cadreLocked!==undefined)){
          if(!upatch.cadre||!validCadre_(upatch.cadre,upatch.targetPost))return {ok:false,error:"Unknown cadre or post"};
          uclean.cadre=upatch.cadre;
          if(upatch.targetPost!==undefined)uclean.targetPost=upatch.targetPost;
          uclean.cadreLocked=true;   // candidates may LOCK once, never unlock/re-pick
        }
      }else{
        if(role==="admin"&&target.createdBy!==actor.id)return deny();   // ownership
        ["name","attemptsAllocated","cadre","targetPost","cadreLocked"].forEach(function(f){if(upatch[f]!==undefined)uclean[f]=upatch[f];});
        if(uclean.cadre!==undefined&&!validCadre_(uclean.cadre,uclean.targetPost))return {ok:false,error:"Unknown cadre or post"};
        if(uclean.attemptsAllocated!==undefined)uclean.attemptsAllocated=Math.max(0,Math.floor(Number(uclean.attemptsAllocated)||0));
      }
      if(body.password){
        var perr4=pwError_(body.password); if(perr4)return {ok:false,error:perr4};
        var ump2=makePass(String(body.password));uclean.passHash=ump2.passHash;uclean.salt=ump2.salt;
      }
      if(Object.keys(uclean).length)store.update("Users",body.id,uclean);
      return {ok:true};
    }
    case "deleteUser": {
      if(role==="user")return deny();
      var dtgt=findRec(store,"Users",body.id);
      if(role==="admin"&&(!dtgt||dtgt.createdBy!==actor.id))return deny();
      store.remove("Users",body.id);
      if(store.replaceAll){store.replaceAll("Attempts",store.readAll("Attempts").filter(function(a){return a.userId!==body.id;}));}
      else{store.readAll("Attempts").filter(function(a){return a.userId===body.id;}).forEach(function(a){store.remove("Attempts",a.id);});}
      return {ok:true};
    }

    case "addAttempt": {
      var arc=body.rec||{};
      if(role==="user"&&arc.userId!==actor.id)return deny();
      var owner=findRec(store,"Users",arc.userId); if(!owner)return {ok:false,error:"User not found"};
      if(role==="admin"&&owner.createdBy!==actor.id)return deny();
      var used=store.readAll("Attempts").filter(function(a){return a.userId===arc.userId;}).length;
      if(used>=(owner.attemptsAllocated||0))return {ok:false,error:"No attempts remaining"};   // server-enforced cap
      /* Re-grade on the server: the client's own score and per-question "correct" flags are ignored. */
      var qmap={},seenQ={},per=[];
      store.readAll("Questions").forEach(function(q){qmap[q.id]=q;});
      (Array.isArray(arc.per)?arc.per:[]).slice(0,MAX_EXAM_LENGTH).forEach(function(p){
        if(!p||typeof p.qid!=="string"||seenQ[p.qid])return; seenQ[p.qid]=1;
        var q=qmap[p.qid], visible=q&&scopeVisibleTo(q.scope,owner.cadre);
        per.push({qid:p.qid,category:q?q.category:String(p.category||""),type:q?q.type:String(p.type||""),
          given:p.given,correct:!!visible&&cbtGrade(q,p.given)});
      });
      var score=per.filter(function(p){return p.correct;}).length,total=per.length;
      var rec={id:(typeof arc.id==="string"&&/^[\w-]{4,64}$/.test(arc.id))?arc.id:uid("att"),userId:arc.userId,cadre:owner.cadre||null,
        startedAt:Number(arc.startedAt)||Date.now(),endedAt:Number(arc.endedAt)||Date.now(),
        score:score,total:total,pct:total>0?Math.round(score/total*100):0,per:per,serverTs:Date.now()};
      if(JSON.stringify(rec).length>45000)return {ok:false,error:"This attempt is too large to store"};
      store.append("Attempts",rec);
      return {ok:true,used:used+1,allowed:owner.attemptsAllocated||0,score:score,total:total,pct:rec.pct,per:per};
    }

    case "dedupeQuestions": {
      if(role!=="super")return deny();
      var allq=store.readAll("Questions"),seen={},keep=[],removed=0;
      for(var di=0;di<allq.length;di++){var dq=allq[di];var sig=(dq.scope||"")+"||"+(dq.category||"")+"||"+(dq.type||"")+"||"+(dq.stem||"");
        if(seen[sig])removed++;else{seen[sig]=1;keep.push(dq);}}
      if(removed>0&&store.replaceAll)store.replaceAll("Questions",keep);
      return {ok:true,removed:removed,remaining:keep.length};
    }

    case "setConfig": {
      if(role==="user")return deny();
      var cpatch=body.patch||{}, cclean={}, cAllow=(role==="super")?["examLength","durationMins","aiProvider","aiModel","aiKey"]:["examLength","durationMins"];
      for(var ck in cpatch){if(cAllow.indexOf(ck)>=0)cclean[ck]=cpatch[ck];}
      if(cclean.examLength!==undefined){var el=Math.floor(Number(cclean.examLength));if(!(el>=1&&el<=MAX_EXAM_LENGTH))return {ok:false,error:"Questions per session must be 1–"+MAX_EXAM_LENGTH};cclean.examLength=el;}
      if(cclean.durationMins!==undefined){var dm=Math.floor(Number(cclean.durationMins));if(!(dm>=1&&dm<=600))return {ok:false,error:"Time limit must be 1–600 minutes"};cclean.durationMins=dm;}
      var next=store.setConfig(cclean);
      return {ok:true,config:publicConfig(next,role)};
    }

    default: return {ok:false,error:"Unknown action: "+action};
  }
}

/* ===== GOOGLE APPS SCRIPT GLUE (Sheets-backed store + web-app entry points) ===== */
function ss_(){return SpreadsheetApp.getActiveSpreadsheet();}
function sheetOf_(name){var s=ss_();var sh=s.getSheetByName(name);if(!sh)sh=s.insertSheet(name);return sh;}
/* Seeding runs under the script lock, so two simultaneous first requests cannot seed twice. */
function ensureSetup_(){
  if(seedComplete_(makeStore_().getConfig()))return;
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(30000))throw new Error("busy");
  try{SHEETS.forEach(function(n){sheetOf_(n);});ensureSeed(makeStore_());}
  finally{lock.releaseLock();}
}
function makeStore_(){
  function readAll(n){var sh=sheetOf_(n);var last=sh.getLastRow();if(last<1)return [];var vals=sh.getRange(1,1,last,2).getValues();var out=[];for(var i=0;i<vals.length;i++){var c=vals[i][1];if(!c)continue;try{out.push(JSON.parse(c));}catch(e){}}return out;}
  function findRow(n,id){var sh=sheetOf_(n);var last=sh.getLastRow();if(last<1)return -1;var ids=sh.getRange(1,1,last,1).getValues();for(var i=0;i<ids.length;i++){if(ids[i][0]===id)return i+1;}return -1;}
  function append(n,rec){sheetOf_(n).appendRow([rec.id,JSON.stringify(rec)]);return rec;}
  function appendMany(n,recs){if(!recs.length)return;var sh=sheetOf_(n);var rows=recs.map(function(r){return [r.id,JSON.stringify(r)];});sh.getRange(sh.getLastRow()+1,1,rows.length,2).setValues(rows);}
  function update(n,id,patch){var sh=sheetOf_(n);var r=findRow(n,id);if(r<0)return null;var rec=JSON.parse(sh.getRange(r,2).getValue());for(var k in patch)rec[k]=patch[k];sh.getRange(r,2).setValue(JSON.stringify(rec));return rec;}
  function remove(n,id){var sh=sheetOf_(n);var r=findRow(n,id);if(r>0)sh.deleteRow(r);}
  function replaceAll(n,recs){var sh=sheetOf_(n);sh.clearContents();if(recs&&recs.length){var out=[];for(var i=0;i<recs.length;i++)out.push([recs[i].id,JSON.stringify(recs[i])]);sh.getRange(1,1,out.length,2).setValues(out);}}
  function find(n,id){var r=findRow(n,id);if(r<0)return null;try{return JSON.parse(sheetOf_(n).getRange(r,2).getValue());}catch(e){return null;}}
  function getConfig(){var sh=sheetOf_("Config");var v=sh.getRange(1,1).getValue();if(!v)return {};try{return JSON.parse(v);}catch(e){return {};}}
  function setConfig(patch){var cur=getConfig();for(var k in patch)cur[k]=patch[k];sheetOf_("Config").getRange(1,1).setValue(JSON.stringify(cur));return cur;}
  return {readAll:readAll,append:append,appendMany:appendMany,update:update,remove:remove,replaceAll:replaceAll,find:find,getConfig:getConfig,setConfig:setConfig,findRow:findRow};
}
function jsonOut_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function b64urlDec_(s){s=String(s).replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";return Utilities.newBlob(Utilities.base64Decode(s)).getDataAsString("UTF-8");}
var WRITES={login:1,logout:1,createAccount:1,updateAccount:1,deleteAccount:1,createUser:1,updateUser:1,deleteUser:1,addQuestions:1,deleteQuestion:1,addAttempt:1,setConfig:1,dedupeQuestions:1};
/* Writes run under the script lock; if the lock cannot be obtained the write is refused rather than run unlocked. */
function run_(body){
  if(!WRITES[body.action])return handleRequest(makeStore_(),body);
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))return {ok:false,error:"The server is busy. Please try again in a moment."};
  try{return handleRequest(makeStore_(),body);}finally{lock.releaseLock();}
}
function busyOr_(err){return (err&&err.message==="busy")?{ok:false,error:"The server is busy. Please try again in a moment."}:{ok:false,error:"Server error"};}
function doGet(e){
  var cb=e&&e.parameter&&e.parameter.callback;
  if(cb&&!/^[A-Za-z_$][\w$]{0,63}$/.test(cb))return jsonOut_({ok:false,error:"Bad callback"});   // JSONP callback must be a plain identifier
  try{
    if(!cb)return jsonOut_({ok:true});   // plain health check when opened in a browser
    ensureSetup_();
    var body={};
    if(e.parameter.p)body=JSON.parse(b64urlDec_(e.parameter.p));
    else if(e.parameter.action)body={action:e.parameter.action,token:e.parameter.token};
    return ContentService.createTextOutput(cb+"("+JSON.stringify(run_(body))+")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }catch(err){
    try{Logger.log("doGet error: "+((err&&err.stack)||err));}catch(ig3){}
    return ContentService.createTextOutput(cb+"("+JSON.stringify(busyOr_(err))+")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}
function doPost(e){
  try{
    ensureSetup_();
    var body=JSON.parse((e&&e.postData&&e.postData.contents)||"{}");
    return jsonOut_(run_(body));
  }catch(err){try{Logger.log("doPost error: "+((err&&err.stack)||err));}catch(ig){} return jsonOut_(busyOr_(err));}
}

/* ===== RECOVERY / DIAGNOSTIC TOOLS — run these from the Apps Script editor (Run ▸ choose function) ===== */
function resetSuperAdmin(){
  ensureSetup_();var store=makeStore_();
  var accs=store.readAll("Accounts"),sup=null,i;
  for(i=0;i<accs.length;i++){if(accs[i].role==="super"){sup=accs[i];break;}}
  var mp=makePass("changeme123");
  /* mustChange:true forces a new password at the next login instead of leaving the default in place. */
  if(sup)store.update("Accounts",sup.id,{username:"superadmin",passHash:mp.passHash,salt:mp.salt,mustChange:true});
  else store.append("Accounts",{id:"acc_super",role:"super",username:"superadmin",passHash:mp.passHash,salt:mp.salt,name:"System Super Admin",createdAt:Date.now(),mustChange:true});
  var msg="Super admin is now: superadmin / changeme123 (must be changed at next login)";Logger.log(msg);return msg;
}
function diagnostics(){
  ensureSetup_();var s=makeStore_();
  var out={Accounts:s.readAll("Accounts").length,Users:s.readAll("Users").length,Questions:s.readAll("Questions").length,Attempts:s.readAll("Attempts").length,Sessions:s.readAll("Sessions").length,config:s.getConfig()};
  if(out.config.aiKey)out.config.aiKey="(set)";
  var accts=s.readAll("Accounts").map(function(a){return a.role+":"+a.username;});
  Logger.log("COUNTS "+JSON.stringify(out));Logger.log("ACCOUNTS "+accts.join(", "));return out;
}
function clearSessions(){ensureSetup_();makeStore_().replaceAll("Sessions",[]);Logger.log("Sessions cleared");return "Sessions cleared";}
/* Tip: add a daily time-driven trigger for pruneSessions (Triggers ▸ Add trigger) so the Sessions sheet stays small. */
function pruneSessions(){
  ensureSetup_();var s=makeStore_();var now=Date.now();
  var keep=s.readAll("Sessions").filter(function(x){return x.ts&&(now-x.ts)<=SESSION_TTL_MS;});
  s.replaceAll("Sessions",keep);Logger.log("Sessions kept: "+keep.length);return "Sessions kept: "+keep.length;
}

/* ============================================================
   CBT Platform — Google Apps Script backend
   Deploy as a Web App (Execute as: Me; Who has access: Anyone).
   Bind this script to a Google Sheet (Extensions > Apps Script).

   SINGLE-FILE BUILD: this one Code.gs contains everything (shared data and
   question banks are appended at the bottom). It is the only script file the
   project needs.

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


/* ==================== inlined from cbt-shared.js ==================== */
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


/* ==================== inlined from cbt-bank-permsec.js ==================== */
/* ============================================================
   PERMANENT SECRETARY CADRE — question bank
   (browser: <script src>; Apps Script: paste as "cbt-bank-permsec.gs")

   Modelled on the areas the Lagos State Permanent Secretary selection
   process is reported to test (written papers + interview for GL 17
   Directors): the same subjects as the general promotion examination,
   set at managerial / policy level, plus governance, public finance,
   leadership and situational judgement. Actual past papers are not
   published; nothing here is presented as a leaked or official paper.
   Statutory references are to the 1999 Constitution (as amended), the
   Public Service Rules, Financial Regulations and the Lagos procurement
   law — re-check figures against the current editions before an exam.
   ============================================================ */
var SEED_PERMSEC=(function(){
  var S="Permanent Secretary Cadre",out=[];
  function add(c,d,type,stem,extra,ex){var q={scope:S,category:c,type:type,difficulty:d,stem:stem,explanation:ex};for(var k in extra)q[k]=extra[k];out.push(q);}
  function mcq(c,d,stem,o,a,ex){add(c,d,"mcq",stem,{options:o,answer:a},ex);}
  function tf(c,d,stem,a,ex){add(c,d,"truefalse",stem,{answer:a},ex);}
  function sa(c,d,stem,acc,ex){add(c,d,"shortanswer",stem,{accept:acc},ex);}
  function ord(c,d,stem,items,ex){add(c,d,"ordering",stem,{items:items},ex);}
  function mat(c,d,stem,pairs,ex){add(c,d,"matching",stem,{pairs:pairs.map(function(p){return {l:p[0],r:p[1]};})},ex);}
  var Q="Quantitative",V="Qualitative",L="Logic",E="English and Grammar",R="Lagos State Civil Service Rules",
      F="Lagos State Financial Regulations",A="Current Affairs",I="ICT",P="Public Policy & Governance",M="Leadership & Strategic Management";

  /* ===================== QUANTITATIVE (managerial) ===================== */
  mcq(Q,"medium","A Ministry's approved capital vote is ₦2.4bn. By year-end, ₦2.07bn has been spent. What is the budget utilisation rate?",["82.5%","86.25%","88.0%","13.75%"],1,"Utilisation = 2.07 ÷ 2.4 × 100 = 86.25%. (13.75% is the unspent share.)");
  mcq(Q,"hard","A capital budget rises from ₦600bn to ₦690bn in Year 2 and is then cut by 10% in Year 3. What is the net change from Year 1 to Year 3?",["+5.0%","+3.5%","−3.5%","+4.5%"],1,"Year 2 = 690 (+15%). Year 3 = 690 × 0.9 = 621. Net change = (621 − 600)/600 = +3.5%. Successive percentages do not simply add (15 − 10 ≠ 5).");
  mcq(Q,"hard","Internally generated revenue grows from ₦400bn to ₦484bn over two years at a constant annual rate. What is that annual growth rate?",["10%","10.5%","11%","21%"],0,"484/400 = 1.21 = (1.1)². The compound annual growth rate is 10%; 21% is the two-year total.");
  mcq(Q,"hard","A project costs ₦100m today and returns ₦60m at the end of Year 1 and ₦60m at the end of Year 2. At a 10% discount rate, its Net Present Value is closest to:",["₦20.00m","₦4.13m","−₦4.13m","₦9.09m"],1,"PV = 60/1.1 + 60/1.21 = 54.55 + 49.59 = 104.13. NPV = 104.13 − 100 = ₦4.13m (positive, so the project adds value at 10%).");
  sa(Q,"medium","Three departments have average APER scores of 70 (40 staff), 80 (60 staff) and 60 (100 staff). What is the weighted average score for the whole Ministry? (number only)",["68"],"(70×40 + 80×60 + 60×100) ÷ 200 = (2,800 + 4,800 + 6,000) ÷ 200 = 13,600 ÷ 200 = 68. A simple average of the three (70) would ignore department sizes.");
  mcq(Q,"medium","Seven contract values (₦m) are: 12, 45, 7, 30, 18, 25, 9. Which statement is correct?",["Median = 18 and mean ≈ 20.9","Median = 30 and mean = 18","Median = 18 and mean = 18","Median = 25 and mean ≈ 20.9"],0,"Sorted: 7, 9, 12, 18, 25, 30, 45 → median 18. Sum = 146, mean = 146/7 ≈ 20.9. The mean exceeds the median because of the large value (45) — a right-skewed set.");
  mcq(Q,"medium","A Ministry has 5,000 staff. With no recruitment and an attrition rate of 4% a year, how many staff remain after two years?",["4,600","4,608","4,800","4,592"],1,"5,000 × 0.96 × 0.96 = 4,608. Attrition compounds on the shrinking base, so it is not 5,000 − 2×200.");
  mcq(Q,"easy","In a ₦1.2 trillion budget, Education receives ₦180bn. On a pie chart of the budget, the Education sector's angle is:",["15°","45°","54°","60°"],2,"180/1,200 = 15% of the budget; 15% of 360° = 54°.");
  sa(Q,"medium","Recurrent and capital expenditure are in the ratio 2:3 and total ₦2.25 trillion. What is capital expenditure in ₦ trillion? (number only, e.g. 1.2)",["1.35","1.350"],"Capital share = 3/5 × 2.25 = 1.35 trillion.");
  mcq(Q,"hard","An agency charges ₦2,500 per vehicle inspection. Variable cost is ₦1,000 per inspection and annual fixed costs are ₦30m. How many inspections a year are needed to break even?",["12,000","20,000","30,000","15,000"],1,"Contribution per inspection = 2,500 − 1,000 = ₦1,500. Break-even = 30,000,000 ÷ 1,500 = 20,000 inspections.");
  mcq(Q,"hard","Three of the 12 Directors in a Ministry come from the Finance department. If two Directors are chosen at random for a panel, what is the probability that both come from Finance?",["1/16","1/22","1/8","1/12"],1,"P = 3/12 × 2/11 = 6/132 = 1/22 (the second pick is from 11 Directors, 2 of them from Finance).");
  mcq(Q,"medium","₦50m is invested at 12% per annum compounded annually. What is the interest earned after 2 years?",["₦12.00m","₦12.72m","₦62.72m","₦6.00m"],1,"Amount = 50 × 1.12² = 50 × 1.2544 = 62.72m. Interest = 62.72 − 50 = ₦12.72m (simple interest would give ₦12m).");
  tf(Q,"medium","If a Ministry's nominal budget rises by 25% in a year when inflation is 25%, its budget has grown by about 0% in real terms.",true,"Real growth = (1.25 ÷ 1.25) − 1 = 0%. The extra Naira only keep pace with prices.");
  mcq(Q,"medium","Audit Team A can complete a review in 12 days; Team B needs 18 days. Working together at the same rates, they will finish in:",["7.2 days","15 days","6 days","9 days"],0,"Combined rate = 1/12 + 1/18 = 5/36 of the job per day → 36/5 = 7.2 days.");
  mcq(Q,"easy","A state with an estimated population of 20 million raises ₦1.0 trillion in IGR. IGR per head is:",["₦5,000","₦20,000","₦50,000","₦500,000"],2,"1,000,000,000,000 ÷ 20,000,000 = ₦50,000 per person.");
  mcq(Q,"hard","A tax-compliance rate rises from 40% to 50%. Which statement is correct?",["It rose by 10% and by 10 percentage points","It rose by 25% and by 10 percentage points","It rose by 10% and by 25 percentage points","It rose by 20% and by 10 percentage points"],1,"The change is 10 percentage points (50 − 40), which is a 25% relative increase (10/40). Reports must not confuse the two.");
  sa(Q,"medium","The mean of five project scores is 60. If one project scoring 80 is removed, what is the mean of the remaining four? (number only)",["55"],"Total = 5 × 60 = 300. Without 80: 220 ÷ 4 = 55.");
  sa(Q,"hard","A vote of ₦8,000,000 has payments made of ₦1,300,000 and unpaid commitments (LPOs raised) of ₦5,200,000. What uncommitted balance is still available? (figures only)",["1500000","1,500,000","₦1,500,000"],"Available balance = Vote − (payments + outstanding commitments) = 8,000,000 − 6,500,000 = ₦1,500,000. This is the figure the vote book protects.");
  mcq(Q,"medium","A construction cost index stands at 100 in 2020 and 180 in 2025. A contract that cost ₦50m in 2020 would cost about how much at 2025 prices?",["₦80m","₦90m","₦130m","₦230m"],1,"Scale by the index: 50 × 180/100 = ₦90m.");
  mcq(Q,"hard","Two units both average 70% on a service-quality survey. Unit A's standard deviation is 2; Unit B's is 9. The best interpretation is:",["Unit B performs better","Unit A's performance is more consistent","Both units are identical in every respect","Unit A's average is higher"],1,"Equal means, but a smaller standard deviation means Unit A's scores cluster tightly around 70 — more consistent service.");
  ord(Q,"hard","Arrange these values from SMALLEST to LARGEST.",["35%","3/8","0.4","5/12"],"35% = 0.35; 3/8 = 0.375; 0.4; 5/12 ≈ 0.4167.");
  mcq(Q,"medium","Of a ₦4bn capital release plan, 20%, 25% and 30% were released in Q1, Q2 and Q3. How much is left for Q4?",["₦0.75bn","₦1.0bn","₦1.25bn","₦3.0bn"],1,"Released = 75%; remaining = 25% × 4bn = ₦1.0bn.");
  mcq(Q,"hard","A $10m loan is booked at ₦1,500/$. If the Naira depreciates to ₦1,650/$, by how much does the Naira value of the debt rise?",["₦150m","₦1.5bn","₦15bn","₦16.5bn"],1,"Before: 10m × 1,500 = ₦15bn. After: 10m × 1,650 = ₦16.5bn. Increase = ₦1.5bn (10%) — the foreign-exchange risk of dollar borrowing.");
  tf(Q,"easy","If staff strength rises by 20% and then falls by 20%, it returns to its original level.",false,"1.2 × 0.8 = 0.96 — a net 4% fall. Equal percentage rises and falls do not cancel.");
  sa(Q,"medium","Quarterly spending was ₦120m, ₦150m and ₦90m in Q1–Q3. What must Q4 spending be (in ₦m) for the quarterly average to be ₦130m? (number only)",["160"],"Annual total needed = 4 × 130 = 520. Spent so far = 360. Q4 = 520 − 360 = 160.");
  mcq(Q,"hard","A 25-member board has men and women in the ratio 3:2. How many women must be added (with no one leaving) to make the ratio 1:1?",["3","5","10","15"],1,"Men = 15, women = 10. For 1:1 you need 15 women, i.e. 5 more.");
  mcq(Q,"hard","A Ministry's wage bill is ₦36bn and its total recurrent budget is ₦60bn. If the wage bill rises 10% and other recurrent costs stay the same, personnel cost as a share of recurrent spending becomes about:",["60%","62.3%","66%","64%"],1,"New wage bill = 39.6bn; total = 39.6 + 24 = 63.6bn; share = 39.6/63.6 ≈ 62.3%.");

  /* ===================== QUALITATIVE / VERBAL REASONING ===================== */
  mcq(V,"medium","Choose the word closest in meaning to PERFUNCTORY.",["Thorough","Cursory","Punctual","Officious"],1,"Perfunctory = done as a routine, with little care — cursory.");
  mcq(V,"hard","Choose the word OPPOSITE in meaning to OBDURATE.",["Stubborn","Amenable","Callous","Obstinate"],1,"Obdurate = stubbornly refusing to change; its opposite is amenable (open to persuasion).");
  mcq(V,"medium","Choose the word closest in meaning to PROBITY.",["Inquiry","Integrity","Probation","Prudence"],1,"Probity = strict honesty and integrity — a core public-service value.");
  mcq(V,"medium","Complete the analogy: Policy is to Implementation as Blueprint is to ___",["Architect","Construction","Drawing","Plan"],1,"A policy is put into effect by implementation; a blueprint is put into effect by construction.");
  mcq(V,"easy","Pick the ODD one out.",["Accountability","Transparency","Probity","Nepotism"],3,"The first three are governance virtues; nepotism (favouring relatives) is a vice.");
  mcq(V,"medium","An action described as 'ultra vires' is one that is:",["Within the officer's powers","Beyond the legal powers of the person or body","Approved retrospectively","Taken in an emergency"],1,"Ultra vires = 'beyond the powers'. Such acts are void and can be set aside.");
  mcq(V,"medium","When a meeting is adjourned 'sine die', it is adjourned:",["Until the next day","Without a date fixed for resuming","For one week","Permanently dissolved"],1,"Sine die = without a day being fixed.");
  mcq(V,"hard","'The regulations apply to the agencies mutatis mutandis.' This means they apply:",["Without any change at all","With the necessary changes made to suit the agencies","Only after amendment by the legislature","Retrospectively"],1,"Mutatis mutandis = with the necessary changes having been made.");
  sa(V,"medium","Give one word for 'an earlier decision or action used as an example or guide in later similar situations'.",["precedent","a precedent"],"A precedent guides later decisions — in administration as in law.");
  mcq(V,"hard","'Complaints fell by 30% after the Ministry launched its online complaints portal, so the portal improved service quality.' What is the MOST serious weakness in this reasoning?",["The figure should be in absolute numbers","Fewer complaints may reflect that some citizens could not use the portal, not better service","Portals are expensive","The Ministry should have used a call centre"],1,"A drop in recorded complaints can mean reduced access to the complaint channel. The claim confuses a change in measurement with a change in quality.");
  mat(V,"medium","Match each idiom to its meaning.",[["Pass the buck","Shift responsibility to someone else"],["Cut corners","Do something cheaply or improperly to save time"],["Toe the line","Conform to the rules or policy"],["Bite the bullet","Face a difficult decision with courage"]],"Common idioms in management discourse.");
  mcq(V,"easy","Choose the word closest in meaning to EXPEDITE.",["Delay","Hasten","Expend","Explain"],1,"To expedite is to speed up a process.");
  mcq(V,"medium","Choose the word OPPOSITE in meaning to AMELIORATE.",["Improve","Worsen","Alleviate","Mitigate"],1,"Ameliorate = make better; the opposite is worsen.");
  mcq(V,"hard","Pick the ODD one out among these public-finance terms.",["Audit","Appraisal","Evaluation","Appropriation"],3,"Audit, appraisal and evaluation all assess performance; appropriation is the legislative authorisation of spending.");
  mcq(V,"medium","Complete the analogy: Legislature is to Laws as Judiciary is to ___",["Courts","Judgments","Lawyers","Prisons"],1,"The legislature produces laws; the judiciary produces judgments.");
  mcq(V,"medium","A hearing held 'in camera' is held:",["On television","In private","In the open court","By video recording"],1,"In camera = in private, with the public excluded.");
  mcq(V,"hard","Choose the best phrase: 'The officer was redeployed ___ the Head of Service's circular.'",["pursuant to","persuant to","pursuant with","in pursuance with"],0,"'Pursuant to' (= in accordance with) is the correct form and spelling.");
  mcq(V,"easy","A 'bona fide' applicant is one who is:",["Fraudulent","Genuine / acting in good faith","Temporary","Foreign"],1,"Bona fide = in good faith; genuine.");
  tf(V,"easy","An 'ad hoc' committee is one set up for a specific purpose and usually dissolved when that purpose is achieved.",true,"Ad hoc = for this (particular purpose).");
  mat(V,"medium","Match each Latin expression to its meaning.",[["Inter alia","Among other things"],["Pro rata","In proportion"],["Status quo","The existing state of affairs"],["Ex officio","By virtue of one's office"]],"Common Latin terms in official minutes and memos.");
  mcq(V,"medium","Choose the word closest in meaning to SALIENT.",["Hidden","Most noticeable or important","Salty","Secondary"],1,"Salient points are the most prominent or important ones.");

  /* ===================== LOGIC / CRITICAL REASONING ===================== */
  mcq(L,"hard","Rule: 'If a contract exceeds the threshold, it must be approved by the Tenders Board.' Which statement is logically EQUIVALENT?",["If a contract is approved by the Tenders Board, it exceeds the threshold","If a contract does not exceed the threshold, it is not approved by the Board","If a contract was not approved by the Tenders Board, it does not exceed the threshold (assuming the rule was obeyed)","All contracts need Tenders Board approval"],2,"The contrapositive of 'if P then Q' is 'if not Q then not P'. The first two options are the converse and inverse — common fallacies.");
  mcq(L,"hard","'Only officers with an APER score of at least 70 are eligible for promotion.' Officer Bola is eligible. What MUST be true?",["Bola will be promoted","Bola has an APER score of at least 70","Everyone with 70+ is eligible","Bola scored exactly 70"],1,"'Only X are Y' means Y → X. Eligibility requires 70+, but a score of 70+ is necessary, not sufficient, for eligibility or promotion.");
  mcq(L,"medium","All Permanent Secretaries are Accounting Officers. No Accounting Officer may approve his or her own claim. Therefore:",["Some Permanent Secretaries may approve their own claims","No Permanent Secretary may approve his or her own claim","All Accounting Officers are Permanent Secretaries","Nothing follows"],1,"Valid syllogism: every PS is in the class of Accounting Officers, which is wholly excluded from self-approval.");
  mcq(L,"medium","Some Directors are lawyers. All lawyers are members of the Bar Association. Therefore:",["All Directors are Bar members","Some Directors are Bar members","No Director is a Bar member","Some Bar members are not lawyers"],1,"The Directors who are lawyers must be Bar members, so at least some Directors are Bar members.");
  mcq(L,"easy","'We have always processed files this way, so it must be the right way.' This argument commits the fallacy of:",["Appeal to tradition","Straw man","Ad hominem","False cause"],0,"Appeal to tradition assumes something is right because it is long-standing.");
  mcq(L,"medium","'We should reject the Director's budget proposal because she was once queried for lateness.' This is an example of:",["Ad hominem","Red herring by statistics","Slippery slope","Begging the question"],0,"Attacking the person instead of the proposal is an ad hominem fallacy.");
  mcq(L,"medium","'Since the new Commissioner assumed office, flooding has fallen; the Commissioner therefore caused the reduction.' This reasoning is weakest because it:",["Uses statistics","Assumes that sequence proves causation (post hoc)","Attacks the Commissioner","Relies on an expert"],1,"Post hoc ergo propter hoc: rainfall, completed drainage works or other factors may explain the change.");
  mcq(L,"medium","'Either we privatise the agency or it will collapse.' The main flaw is:",["False dilemma — other options (restructuring, concession, PPP) are ignored","Circular reasoning","Hasty generalisation","Appeal to pity"],0,"A false dilemma presents two options as the only ones available.");
  mcq(L,"hard","'The Ministry should move all its services online because this will shorten queues at its offices.' Which ASSUMPTION does the argument depend on?",["Online services are cheaper to build","A significant share of service users can and will use online channels","Queues are caused by staff lateness","Other Ministries have gone online"],1,"If most users cannot access online services, queues will not shorten. The argument silently assumes adequate digital access and uptake.");
  mcq(L,"hard","'Introducing biometric attendance will raise staff productivity.' Which finding would MOST WEAKEN this claim?",["Biometric devices are affordable","Attendance was already near 100%; low productivity stems from unclear work assignments","Other states use biometrics","Staff support the new system"],1,"If attendance is not the constraint, a tool that improves attendance cannot be expected to lift productivity.");
  mcq(L,"hard","A pilot found that schools receiving new textbooks had higher pass rates. Which finding would MOST STRENGTHEN the conclusion that textbooks caused the improvement?",["Pilot schools were chosen because they already had the best results","Schools were randomly assigned, and similar control schools without textbooks did not improve","Teachers liked the textbooks","Pass rates rose nationally that year"],1,"Random assignment with a comparable control group rules out selection effects and general trends.");
  mcq(L,"easy","Find the next number: 3, 7, 15, 31, 63, ___",["95","126","127","131"],2,"Each term is ×2 + 1 (or the differences double: 4, 8, 16, 32, 64). 63 × 2 + 1 = 127.");
  mcq(L,"medium","Find the next letter: A, C, F, J, O, ___",["T","U","V","S"],1,"Gaps grow by one: +2, +3, +4, +5, then +6. O (15) + 6 = U (21).");
  sa(L,"medium","Find the next number: 2, 3, 5, 9, 17, ___ (number only)",["33"],"Differences double: +1, +2, +4, +8, +16 → 17 + 16 = 33.");
  mcq(L,"hard","Five meetings P, Q, R, S and T are scheduled Monday to Friday, one per day. R is on Friday. T is on Wednesday. Q is held on the day immediately after P. On which day is S?",["Monday","Tuesday","Thursday","Cannot be determined"],2,"Free days: Mon, Tue, Thu. P and Q must be consecutive, so they take Mon–Tue (Thu–Fri is impossible as R is on Friday). S takes Thursday.");
  mcq(L,"hard","What is the total staff strength of a Ministry? (1) 60% of the staff are male. (2) There are 240 female staff.",["Statement (1) alone is sufficient","Statement (2) alone is sufficient","Both together are sufficient, but neither alone","Both together are not sufficient"],2,"From (1), females are 40%. With (2), 40% = 240, so total = 600. Neither statement alone fixes the total.");
  mcq(L,"easy","An inspection team drives 4 km due North, then 3 km due East. How far is it in a straight line from the starting point?",["5 km","7 km","1 km","6 km"],0,"Right-angled triangle: √(4² + 3²) = √25 = 5 km.");
  mcq(L,"medium","If PLAN is coded 16-12-1-14, how is BUDGET coded?",["2-21-4-7-5-20","2-20-4-7-5-21","3-21-4-7-5-20","2-21-4-6-5-20"],0,"Each letter is replaced by its position in the alphabet: B2 U21 D4 G7 E5 T20.");
  sa(L,"medium","In a directorate of 50 officers, 30 hold an MBA, 25 hold a law degree and 10 hold both. How many hold neither? (number only)",["5"],"At least one = 30 + 25 − 10 = 45. Neither = 50 − 45 = 5.");
  tf(L,"medium","If 'No auditors are directors' is true, then 'No directors are auditors' must also be true.",true,"A universal negative (E-proposition) converts validly: the two classes simply do not overlap.");
  tf(L,"hard","If 'Some officers are not punctual' is true, then 'Some punctual people are not officers' must also be true.",false,"A particular negative (O-proposition) does not convert. It could be that all punctual people are officers.");
  ord(L,"medium","Arrange the stages of a structured problem-solving approach in the correct order.",["Define the problem","Analyse data and root causes","Generate options","Evaluate and select the best option","Implement the decision","Monitor and review results"],"Rational problem solving moves from definition and diagnosis, through options and choice, to implementation and review.");
  mat(L,"hard","Match each fallacy to its description.",[["Straw man","Misrepresenting an argument to make it easier to attack"],["Slippery slope","Claiming one small step will inevitably lead to an extreme outcome"],["Appeal to authority","Claiming something is true because a powerful person said so"],["Hasty generalisation","Drawing a broad conclusion from too small a sample"]],"Recognising fallacies is essential when reviewing memos and policy proposals.");
  mcq(L,"easy","Which number does NOT belong? 121, 144, 169, 196, 210",["144","169","196","210"],3,"121, 144, 169 and 196 are the squares of 11 to 14; 210 is not a perfect square.");
  mcq(L,"hard","'All revenue collected must be paid into the Treasury Single Account.' Fee X was not paid into the TSA. If the premise is strictly true, what follows?",["Fee X is revenue","Fee X is not revenue collected","The TSA is faulty","Fee X was stolen"],1,"By modus tollens: if every item of revenue goes into the TSA, anything not in it is not revenue. In practice the finding would trigger an audit to check whether the rule was broken.");
  mcq(L,"hard","Four Directors (A, B, C, D) must each head exactly one of four committees (Audit, Budget, Ethics, Training). A will not head Audit or Budget. B heads Ethics. C will not head Training. Who heads Training?",["A","B","C","D"],0,"B has Ethics. A can only take Ethics or Training, and Ethics is taken, so A heads Training. C and D then share Audit and Budget.");

  /* ===================== ENGLISH (official usage) ===================== */
  mcq(E,"easy","Choose the correct option: 'There were ___ applicants for the post this year than last year.'",["less","fewer","lesser","few"],1,"'Fewer' is used with countable nouns (applicants); 'less' with uncountable ones (time, money).");
  mcq(E,"easy","Choose the correct option: 'The new policy will ___ every officer in the Ministry.'",["effect","affect","afect","effects"],1,"'Affect' is the verb (to influence); 'effect' is usually the noun (a result), or a verb meaning 'to bring about'.");
  mcq(E,"easy","Choose the correct option: 'The ___ objective of the reform is efficiency.'",["principle","principal","principals","principly"],1,"'Principal' (adjective) = main. 'Principle' (noun) = a rule or belief.");
  mcq(E,"easy","Choose the correctly used word: 'Please raise a requisition for office ___.'",["stationary","stationery","stationaries","stationeries"],1,"Stationery = writing materials; stationary = not moving.");
  mcq(E,"hard","Choose the correct option: 'The Governor directed that the report ___ submitted within one week.'",["is","was","be","will be"],2,"After verbs of command such as 'direct', 'insist' or 'recommend' that, formal English uses the subjunctive base form: 'be submitted'.");
  mcq(E,"hard","Which sentence is correct?",["The board is comprised of seven members.","The board comprises of seven members.","The board comprises seven members.","The board compose seven members."],2,"'Comprise' means 'consist of' and takes no 'of'. 'Is composed of' is also correct; 'comprises of' is not.");
  mcq(E,"hard","Which sentence avoids a dangling modifier?",["Having reviewed the file, the request was approved.","Having reviewed the file, the Director approved the request.","Having reviewed the file, approval was given.","The request, having reviewed the file, was approved."],1,"The opening phrase must refer to the person who did the reviewing — the Director.");
  mcq(E,"medium","Choose the option that keeps the sentence parallel: 'The Permanent Secretary is responsible for planning, coordinating and ___ the work of the Ministry.'",["to supervise","supervision of","supervising","supervises"],2,"Items in a series should share the same grammatical form: planning, coordinating and supervising.");
  mcq(E,"medium","Choose the correct option: 'To ___ should the memo be addressed?'",["who","whom","whose","who's"],1,"After a preposition ('to'), the object form 'whom' is required.");
  mcq(E,"medium","Choose the correct option: 'The Permanent Secretary, together with the Directors, ___ expected at the retreat.'",["are","is","were","have been"],1,"Phrases such as 'together with' or 'as well as' do not change the subject. 'The Permanent Secretary' is singular.");
  mcq(E,"medium","Choose the correct option: 'Either of the two proposals ___ acceptable to the Commissioner.'",["are","is","were","have been"],1,"'Either' (one or the other) is singular.");
  mcq(E,"medium","Which sentence contains NO redundancy?",["Please return back the file.","The final outcome was positive.","We will reconvene at 10 a.m.","The two officers should cooperate together."],2,"'Return back', 'final outcome' and 'cooperate together' are tautologies; 'reconvene' already means to meet again.");
  mcq(E,"medium","Which is the ACTIVE-voice version of 'The circular was issued by the Head of Service'?",["The Head of Service issued the circular.","The circular has been issued.","The Head of Service was issuing the circular.","Issued was the circular by the Head of Service."],0,"In active voice the doer (Head of Service) is the subject of the verb.");
  mcq(E,"medium","Which group of words is spelt correctly?",["Accomodation, commitment, liaison","Accommodation, committment, liason","Accommodation, commitment, liaison","Acommodation, commitment, liasion"],2,"Correct: accommodation (double c, double m), commitment (one t before -ment), liaison (i-a-i).");
  mcq(E,"medium","Choose the correctly spelt word.",["Supercede","Supersede","Superseed","Superceed"],1,"'Supersede' is the only correct spelling.");
  tf(E,"easy","'Irregardless' is acceptable in formal official writing.",false,"Use 'regardless' (or 'irrespective'). 'Irregardless' is non-standard.");
  sa(E,"easy","Give the plural of 'criterion'.",["criteria"],"Criterion (singular) → criteria (plural). 'The criteria are…', never 'the criteria is…'.");
  sa(E,"medium","Give the noun form of the verb 'adjudicate'.",["adjudication"],"Adjudicate → adjudication (and adjudicator for the person).");
  mat(E,"medium","Match each commonly confused word to its meaning.",[["Council","An advisory or governing body"],["Counsel","Advice, or a lawyer"],["Complement","Something that completes"],["Compliment","An expression of praise"]],"These pairs are frequently confused in official correspondence.");
  ord(E,"medium","Arrange the usual sections of a memo seeking an Executive Council decision in order.",["Purpose","Background","Issues for consideration","Financial implications","Recommendation(s)"],"A council memo states its purpose, gives background, analyses the issues and costs, then sets out specific recommendations for approval.");
  mcq(E,"medium","'Further to our discussion, the proposal has been shelved.' Here 'shelved' means:",["Filed in a cabinet","Put aside indefinitely","Approved","Rejected with reasons"],1,"To shelve a proposal is to postpone it indefinitely without a decision.");

  /* ===================== CIVIL SERVICE RULES & CONSTITUTION ===================== */
  mcq(R,"medium","Under section 208 of the 1999 Constitution, the power to appoint Permanent Secretaries in a State is vested in:",["The State Civil Service Commission","The Governor","The Head of Service","The State House of Assembly"],1,"Section 208 vests the appointment (and removal) of the SSG, the Head of Service, Permanent Secretaries and the Governor's personal staff in the Governor.");
  mcq(R,"medium","Which body has constitutional power to appoint persons to offices in the State Civil Service (other than the s.208 offices), and to discipline and dismiss them?",["The Office of the Head of Service","The State Civil Service Commission","The State Executive Council","The Public Service Staff Development Centre"],1,"Section 197 and Part II of the Third Schedule establish the State Civil Service Commission with these powers. Some of them may be delegated.");
  mcq(R,"hard","Under section 208, the Head of the Civil Service of a State must be appointed from among:",["Any Director in the State","Permanent Secretaries or officers of equivalent rank","Members of the State Executive Council","Retired Permanent Secretaries"],1,"The Constitution requires the Head of Service to be appointed from among Permanent Secretaries or equivalent ranks in the civil service of any State or of the Federation.");
  mcq(R,"hard","In exercising the s.208 powers of appointment, the Governor is constitutionally required to have regard to:",["Seniority only","The diversity of the people within the State and the need to promote national unity","The recommendations of the House of Assembly","Party affiliation"],1,"Section 208(4) imports a diversity requirement into these appointments.");
  mcq(R,"hard","Which s.208 appointments are expressly 'at the pleasure of the Governor' and end when the Governor leaves office?",["Permanent Secretaries","Head of the Civil Service","Secretary to the State Government and the Governor's personal staff","All of them"],2,"Section 208(3) attaches that tenure to the SSG and the Governor's personal staff only. Permanent Secretaries are career appointments governed by the service's tenure policy.");
  mcq(R,"medium","In a disciplinary case, the principle 'audi alteram partem' requires that:",["The officer is dismissed at once","The accused officer is heard before a decision is taken","The panel be chaired by a lawyer","The case be heard in public"],1,"'Hear the other side' — a pillar of fair hearing under s.36 of the Constitution. That is why a query precedes any sanction.");
  mcq(R,"hard","A Director who made a misconduct complaint against an officer is appointed to the panel hearing that case. Which principle is breached?",["Ultra vires","Nemo judex in causa sua","Res judicata","Stare decisis"],1,"No one should be a judge in their own cause. The panel's decision could be set aside for likelihood of bias.");
  mcq(R,"medium","Under the Public Service Rules, an officer on interdiction is ordinarily paid:",["Full salary","Not less than half of the salary","No salary","Only allowances"],1,"Interdiction is a holding measure pending investigation; the officer receives not less than half pay.");
  tf(R,"medium","An officer on suspension is ordinarily entitled to half salary throughout the suspension.",false,"Suspension applies where dismissal or criminal prosecution is in view and is ordinarily without pay. Half pay is the interdiction position.");
  tf(R,"medium","If an interdicted officer is fully exonerated, the officer is entitled to the salary withheld during the interdiction.",true,"An officer cleared of the allegations is restored and paid the withheld portion of salary.");
  mcq(R,"medium","Which of these would normally be treated as a minor matter rather than serious misconduct?",["Falsification of records","Embezzlement of public funds","Lateness to work on a single occasion","Unauthorised disclosure of classified information"],2,"Serious misconduct is grave wrongdoing that can attract dismissal. A single late arrival is a minor lapse dealt with by counselling or warning.");
  mcq(R,"hard","An officer is persistently unable to perform assigned duties despite training and counselling, but no dishonesty is involved. The case is best classified as:",["Serious misconduct","General inefficiency","Criminal offence","Insubordination"],1,"The rules distinguish general inefficiency (lack of competence or effort) from misconduct (wrongful behaviour). Different procedures and outcomes apply.");
  mat(R,"hard","Match each exit route to its usual consequence.",[["Dismissal","Removal for serious misconduct with forfeiture of benefits"],["Termination of appointment","Ending of the appointment under the terms of service"],["Compulsory retirement","Retirement imposed by the service, with retirement benefits"],["Voluntary retirement","Retirement at the officer's request after notice"]],"Dismissal is the most severe because it forfeits benefits; retirement keeps entitlements.");
  mcq(R,"hard","An officer was born on 1 March 1970 and appointed into pensionable service on 1 June 1994. Applying the 60-years-of-age / 35-years-of-service rule, when must the officer retire?",["1 March 2030","1 June 2029","1 June 2030","1 March 2029"],1,"Age 60 is reached on 1 March 2030; 35 years of service are completed on 1 June 2029. The earlier date applies: 1 June 2029.");
  mcq(R,"medium","At the end of probation an officer's performance is unsatisfactory. The proper course is to:",["Confirm the appointment anyway","Extend the probation or terminate the appointment, in line with the rules","Promote the officer to motivate them","Transfer the officer without comment"],1,"Confirmation is not automatic. The rules allow probation to be extended, or the appointment terminated, where performance or conduct is unsatisfactory.");
  tf(R,"medium","Annual leave may be deferred to a later year only with approval, usually on grounds of the exigencies of the service.",true,"Leave is planned on a roster. Deferment requires approval; it is not an automatic right to accumulate leave.");
  mcq(R,"hard","Lagos State's family-friendly leave policy gives female officers maternity leave of ___ and male officers paternity leave of ___.",["3 months; 5 working days","6 months; 10 working days","4 months; 14 working days","12 weeks; none"],1,"Lagos State extended maternity leave to six months and introduced 10 working days' paternity leave — more generous than the federal 16 weeks.");
  mcq(R,"medium","The main purpose of an acting appointment is to:",["Reward long service","Ensure the duties of a vacant higher post are performed pending a substantive appointment","Replace promotion examinations","Punish the substantive holder"],1,"Acting appointments preserve continuity. They confer no automatic right to substantive promotion.");
  mat(R,"hard","Match each staff-movement term to its meaning.",[["Secondment","Temporary release to another organisation while keeping the substantive post"],["Transfer of service","Permanent move between public services with pensionable service preserved"],["Posting","Deployment of an officer within the same service"],["Leave of absence","Approved absence from duty, usually without pay"]],"Each has different implications for seniority, pay and pension.");
  mcq(R,"medium","In the APER process, the officer who reviews and endorses the reporting officer's assessment is the:",["Appraisee","Countersigning officer","Desk officer","Establishment officer"],1,"The countersigning officer, usually the reporting officer's superior, moderates the appraisal and checks for bias.");
  mcq(R,"easy","Which of these is NOT a legitimate criterion for promotion in the public service?",["Performance evaluation (APER) scores","Success in a promotion examination or interview","Availability of a vacancy in the higher post","Personal closeness to the Head of Department"],3,"Promotion rests on merit, vacancy and eligibility. Personal relationships are not a valid criterion.");
  ord(R,"medium","Arrange the main steps in filling a vacant post by external recruitment.",["Confirm the vacancy and its funding","Advertise the post","Shortlist applicants","Conduct the examination or interview","Issue the letter of appointment"],"Due process begins with an established, funded vacancy and ends with a formal offer.");
  ord(R,"hard","Arrange the stages of a fair disciplinary process in order.",["Report of the alleged misconduct","Issue of a query","Officer's written reply","Consideration or hearing by the disciplinary body","Decision communicated to the officer","Appeal or petition by the officer, if any"],"Each stage protects fair hearing: notice, an opportunity to respond, an impartial hearing, a reasoned decision and a right of appeal.");
  tf(R,"easy","A petition from an officer to a higher authority should normally be routed through the proper channel, i.e. through the officer's Head of Department.",true,"Routing through the proper channel keeps the chain of command intact; the rules provide exceptions where the HOD is the subject of the complaint.");
  tf(R,"medium","A public officer may give classified official information to the press, without authority, whenever the officer believes it is in the public interest.",false,"Unauthorised disclosure breaches the Official Secrets Act and the Rules. Concerns should go through lawful whistle-blowing or reporting channels.");
  mcq(R,"medium","Under the Code of Conduct for Public Officers (Fifth Schedule), a public officer must submit a written declaration of assets:",["Only on retirement","Within three months of taking office, every four years thereafter and at the end of the term of office","Every year","Only when requested by the police"],1,"Paragraph 11 of the Fifth Schedule requires declarations on entry, at the end of every four years and at the end of the term.");
  tf(R,"medium","Under the Code of Conduct, a full-time public officer may engage in farming even though he or she may not run a private business, profession or trade.",true,"Paragraph 2(b) of the Fifth Schedule bars full-time public officers from private business, but expressly permits farming.");
  mcq(R,"medium","Alleged breaches of the Code of Conduct for Public Officers are tried by the:",["Code of Conduct Bureau","Code of Conduct Tribunal","State High Court","Civil Service Commission"],1,"The Bureau receives declarations and investigates; the Tribunal tries alleged breaches.");
  mcq(R,"medium","The Lagos State Government's dedicated training institution for public servants is the:",["Administrative Staff College of Nigeria (ASCON)","Public Service Staff Development Centre (PSSDC)","Lagos Business School","Civil Service Commission"],1,"PSSDC, Magodo, runs in-service training for Lagos public servants. ASCON is a federal institution in Badagry.");
  tf(R,"medium","A Permanent Secretary who delegates authority to a Director also transfers ultimate accountability for the outcome to that Director.",false,"Authority can be delegated; ultimate accountability cannot. The delegator remains answerable for how delegated powers are used.");
  mcq(R,"hard","A Director tells you that he intends to retire voluntarily before the compulsory age. Under the usual rules, he must:",["Simply stop coming to work","Give the prescribed notice (normally three months) or pay in lieu, and obtain approval","Obtain the Governor's personal consent","Wait until age 60"],1,"Voluntary retirement requires formal notice through the proper channel so that succession and pension processing can be arranged.");
  mcq(R,"hard","The Fifth Schedule prohibits public officers from accepting gifts or benefits on account of their official duties. Which gift is the Code most likely to permit?",["A car from a contractor after the contract is awarded","A modest customary gift from a relative or personal friend on a recognised occasion","Cash from a member of the public to speed up a file","Travel tickets from a bidder"],1,"The Code allows gifts from relatives and personal friends to the extent, and on the occasions, recognised by custom. Gifts connected to official acts are prohibited.");
  mat(R,"hard","Match each disciplinary measure to its pay position.",[["Interdiction","Not less than half pay pending investigation"],["Suspension","No pay pending the outcome"],["Warning","No change in pay"],["Dismissal","All pay and benefits forfeited"]],"Pay consequences increase with severity.");

  /* ===================== FINANCIAL REGULATIONS & PUBLIC FINANCE ===================== */
  mcq(F,"easy","The Accounting Officer of a Lagos State Ministry is the:",["Commissioner","Permanent Secretary","Director of Finance and Accounts","Accountant-General"],1,"The Permanent Secretary is the Accounting Officer: personally responsible for the proper use of the Ministry's funds and for accounting for them.");
  mcq(F,"medium","Which statement BEST describes the Accounting Officer's personal responsibility?",["It ends once a payment is approved by the Commissioner","He or she must ensure that spending is within the appropriation and properly accounted for, and may be held personally liable for irregularities","It is shared equally with the Internal Auditor","It applies only to capital expenditure"],1,"The Accounting Officer answers to the Public Accounts Committee and may be surcharged for losses due to negligence or wrongdoing.");
  mcq(F,"medium","Under the Constitution (s.120), money may be withdrawn from a State's Consolidated Revenue Fund only:",["On the Governor's verbal directive","To meet expenditure charged on the Fund by the Constitution or authorised by an Appropriation Law","When the Accountant-General approves","At the end of the financial year"],1,"Legislative authorisation is the bedrock of public financial control.");
  mcq(F,"hard","If the Appropriation Bill has not been passed by the start of the financial year, s.122 allows the Governor to authorise withdrawals from the Consolidated Revenue Fund for a period not exceeding:",["3 months","6 months","9 months","12 months"],1,"Section 122 permits expenditure for up to six months, or until the Appropriation Law comes into force, if earlier.");
  mcq(F,"medium","When the amount appropriated for a purpose proves insufficient, or a need arises for which no amount was appropriated, the Governor must:",["Use the excess of another Ministry","Lay a supplementary estimate before the House of Assembly","Borrow without approval","Approve a virement to a new project"],1,"The Constitution provides for supplementary estimates (and a Supplementary Appropriation Law) in these cases.");
  mcq(F,"hard","The Auditor-General for a State is appointed by the Governor:",["Alone","On the recommendation of the State Civil Service Commission, subject to confirmation by the House of Assembly","On the recommendation of the Accountant-General","By election of the House of Assembly"],1,"Section 126 sets this procedure to protect the Auditor-General's independence.");
  mcq(F,"medium","The Auditor-General's report on the State's public accounts is submitted to:",["The Governor only","The House of Assembly, which refers it to its Public Accounts Committee","The Civil Service Commission","The Accountant-General"],1,"Section 125 requires submission to the House of Assembly; legislative scrutiny closes the accountability loop.");
  tf(F,"medium","Internal audit units should be independent of the operations they audit and should report directly to the Accounting Officer.",true,"Independence and direct reporting let internal audit give the Accounting Officer objective assurance.");
  tf(F,"medium","An imprest may be carried over into the next financial year without retirement if the officer intends to use it again.",false,"All imprests must be retired at the end of the financial year; unretired imprests are an audit query and may lead to salary deductions.");
  mcq(F,"hard","Which of the following is generally NOT a permissible use of virement?",["Moving savings between sub-heads of the same vote with approval","Funding a new project that is not provided for in the Appropriation Law","Correcting a shortfall in a sub-head from savings in another sub-head","Re-aligning recurrent items within approved limits"],1,"Virement redistributes existing appropriations. It cannot create a new item of expenditure, which requires a supplementary appropriation.");
  mcq(F,"medium","The main purpose of a Treasury Single Account (TSA) is to:",["Allow each Ministry to keep its own commercial bank accounts","Consolidate government cash in a unified account structure for visibility and better cash management","Pay salaries only","Hold donor funds abroad"],1,"A TSA ends fragmented accounts, idle balances and leakages. Government sees its full cash position in real time.");
  mcq(F,"hard","Under accrual-basis IPSAS, an expense is recognised when:",["Cash is paid","The goods or services are received or consumed, whether or not cash has been paid","The budget is approved","The invoice is filed"],1,"Accrual accounting records transactions when they occur, giving a truer picture of liabilities and the cost of services.");
  mcq(F,"hard","Within the Medium-Term Expenditure Framework, which document sets out sector-level objectives, programmes and costed priorities over three years?",["Economic and Fiscal Update","Fiscal Strategy Paper","Medium-Term Sector Strategy (MTSS)","Appropriation Law"],2,"The MTSS links sector policy to the budget. The EFU and FSP set the macro-fiscal envelope.");
  ord(F,"medium","Arrange the stages of the annual budget cycle in order.",["Issue of the budget call circular","Preparation of estimates by MDAs","Budget defence and consolidation","Presentation of the Appropriation Bill to the House of Assembly","Passage and assent of the Appropriation Law","Implementation, monitoring and audit"],"The cycle runs from call circular to legislative approval, then execution, monitoring and ex-post audit.");
  mcq(F,"medium","Zero-based budgeting requires that:",["Last year's budget is increased by inflation","Every line of expenditure is justified from zero for the new period","Only capital items are budgeted","The budget is balanced at zero"],1,"ZBB challenges the incremental habit by requiring fresh justification of every item.");
  mcq(F,"medium","A Board of Survey is mainly convened to:",["Recruit new staff","Physically verify cash, stores or assets and report on their condition and balances","Approve contracts","Prepare the budget call circular"],1,"Boards of Survey (for example, on cash at year-end) confirm that physical holdings match the records.");
  mcq(F,"medium","On discovering a loss of public funds, the Accounting Officer should FIRST:",["Wait until the end of the year","Report the loss promptly to the Accountant-General and the Auditor-General (and the police where theft is suspected), then investigate","Recover it from staff salaries without inquiry","Write it off"],1,"The regulations require prompt reporting, a full investigation and appropriate recovery or surcharge.");
  mcq(F,"medium","Lagos State public procurement is regulated principally by the:",["Federal Public Procurement Act 2007 only","Lagos State Public Procurement Law, administered by the Lagos State Public Procurement Agency","Companies and Allied Matters Act","Fiscal Responsibility Act"],1,"Lagos has its own procurement law and agency. The federal Act governs federal MDAs.");
  mcq(F,"easy","The default procurement method under modern public procurement laws is:",["Direct procurement","Selective tendering","Open competitive bidding","Emergency procurement"],2,"Open competitive bidding maximises competition and value for money. Other methods need justification.");
  tf(F,"easy","Splitting a large contract into smaller lots to bring each below the approval threshold is a breach of procurement law.",true,"Contract splitting to evade thresholds or oversight is expressly prohibited.");
  mcq(F,"hard","In Lagos State, which instrument from the Public Procurement Agency confirms that due process was followed before a contract above the prescribed threshold is awarded?",["Letter of Credit","Certificate of No Objection","Warrant of Release","Performance Bond"],1,"The Agency reviews the process and issues a Certificate of No Objection before award of contracts above the prescribed threshold.");
  ord(F,"hard","Arrange the main stages of a competitive procurement in order.",["Needs assessment and procurement planning","Advertisement / invitation to bid","Public bid opening","Technical and financial evaluation","Review and approval (including No Objection where required)","Contract award and signing"],"A disciplined sequence protects competition, transparency and value for money.");
  tf(F,"medium","Bids in open competitive bidding should be opened in public, in the presence of bidders or their representatives who wish to attend.",true,"Public bid opening is a core transparency safeguard.");
  mcq(F,"medium","'Value for money' in public spending is traditionally assessed through the '3Es'. These are:",["Equity, Ethics, Excellence","Economy, Efficiency, Effectiveness","Expenditure, Estimate, Evaluation","Efficiency, Endurance, Expansion"],1,"Economy (spending less), efficiency (spending well) and effectiveness (spending wisely). Equity is often added as a fourth E.");
  mcq(F,"hard","Fiscal-responsibility rules usually restrict government borrowing to:",["Paying salaries","Capital expenditure and human development","Any purpose approved by the Governor","Servicing other loans only"],1,"The 'golden rule' allows borrowing to fund long-term investment, not consumption.");
  mcq(F,"medium","A state's total revenue is ₦1.5 trillion and its annual debt service is ₦300bn. Its debt-service-to-revenue ratio is:",["5%","15%","20%","30%"],2,"300 ÷ 1,500 = 20%. Analysts track this ratio to judge debt sustainability.");
  mcq(F,"easy","Which agency collects personal income tax and other state taxes in Lagos State?",["Federal Inland Revenue Service","Lagos State Internal Revenue Service (LIRS)","Lagos State Revenue Board of Appeal","Central Bank of Nigeria"],1,"LIRS administers state taxes, including PAYE for residents of Lagos.");
  mcq(F,"hard","Under Nigeria's 2025 tax reform laws, the Federal Inland Revenue Service is replaced by the:",["Nigeria Revenue Service","Federal Tax Commission","Joint Tax Board","National Revenue Mobilisation Commission"],0,"The Nigeria Revenue Service (Establishment) Act 2025 replaced FIRS with the Nigeria Revenue Service, as part of a package that took effect in 2026.");
  mat(F,"hard","Match each public-finance instrument to its role.",[["Appropriation Law","Legislative authority to spend"],["Warrant","Executive authority releasing funds for spending"],["Virement","Transfer of savings between sub-heads"],["Supplementary appropriation","Additional legislative authority during the year"]],"Spending needs legislative authority (appropriation) and executive release (warrants). Virement and supplementary budgets handle changes during the year.");
  mcq(F,"medium","The 'fraud triangle' explains occupational fraud as arising from:",["Pressure, opportunity and rationalisation","Greed, power and money","Policy, people and process","Audit, budget and control"],0,"Controls work mainly by removing opportunity; ethics and welfare address pressure and rationalisation.");
  tf(F,"easy","Sound internal control requires that the same officer should not initiate, approve and pay the same transaction.",true,"Segregation of duties is a basic preventive control against error and fraud.");
  mcq(F,"hard","A Ministry pays ₦10m in advance in December for a service to be delivered in January. Under accrual accounting, in December this is recorded as:",["An expense","A prepayment (an asset)","A liability","Revenue"],1,"Nothing has been consumed yet, so the payment is an asset (prepayment). It becomes an expense when the service is received.");
  mcq(F,"hard","An asset costing ₦12m with a useful life of 5 years and a residual value of ₦2m is depreciated straight-line. The annual depreciation is:",["₦2.4m","₦2.0m","₦2.8m","₦1.2m"],1,"(Cost − residual) ÷ life = (12 − 2) ÷ 5 = ₦2m a year.");
  mcq(F,"medium","A 'surcharge' recommended after an audit query is BEST described as:",["A tax on contractors","Recovery from an officer of public money lost through that officer's fault or negligence","An increase in the budget","A penalty paid by the government"],1,"Surcharge makes the officer personally liable to repay the loss.");

  /* ===================== CURRENT AFFAIRS & GOVERNANCE ===================== */
  mcq(A,"medium","Lagos State has 20 Local Government Areas and 37 Local Council Development Areas. How many councils is that in total?",["37","50","57","77"],2,"20 LGAs + 37 LCDAs = 57 councils.");
  mcq(A,"medium","How many members sit in the Lagos State House of Assembly?",["24","36","40","45"],2,"The Lagos State House of Assembly has 40 members, the maximum allowed by s.91 of the Constitution.");
  mcq(A,"medium","In the State Government's T.H.E.M.E.S. development agenda, the letter 'M' stands for:",["Mobility and Markets","Making Lagos a 21st-Century Economy","Medical Services","Maritime Security"],1,"T.H.E.M.E.S.: Traffic management & transportation; Health & environment; Education & technology; Making Lagos a 21st-century economy; Entertainment & tourism; Security & governance.");
  mcq(A,"medium","The Lagos State Development Plan launched in 2022 is a long-term plan with a horizon year of:",["2030","2040","2052","2063"],2,"The 30-year Lagos State Development Plan runs to 2052.");
  mcq(A,"medium","The federal Lagos–Calabar Coastal Highway begins in Lagos and runs along the coast towards:",["Kano","Calabar, Cross River State","Maiduguri","Sokoto"],1,"The coastal highway runs about 700 km from Lagos to Calabar.");
  mcq(A,"medium","Phase 1 of the Lagos Rail Mass Transit Blue Line runs between:",["Agbado and Oyingbo","Marina and Mile 2","Ikeja and Lekki","Badagry and Apapa"],1,"Blue Line Phase 1 (Marina–Mile 2) began commercial operations in 2023. The Red Line runs Agbado–Oyingbo.");
  mcq(A,"medium","Nigeria's first fully automated deep-sea port, which began operations in 2023, is located at:",["Apapa","Tin Can Island","Lekki","Badagry"],2,"Lekki Deep Sea Port in Ibeju-Lekki began commercial operations in 2023.");
  mcq(A,"easy","The Dangote Petroleum Refinery is located in:",["Port Harcourt","Warri","The Lekki Free Zone, Ibeju-Lekki, Lagos","Kaduna"],2,"The refinery is in the Lekki Free Zone in Ibeju-Lekki LGA, Lagos State.");
  mcq(A,"medium","The national minimum wage set by the Minimum Wage (Amendment) Act 2024 is:",["₦30,000","₦50,000","₦70,000","₦100,000"],2,"The 2024 Act raised the national minimum wage to ₦70,000 a month.");
  mcq(A,"medium","Which Lagos agency maintains the register of residents of the State?",["LASRRA","LASEPA","LASBCA","LAWMA"],0,"The Lagos State Residents Registration Agency (LASRRA) keeps the residents' database used for planning.");
  mcq(A,"easy","Eko Atlantic City is being built mainly on:",["Former farmland in Epe","Land reclaimed from the Atlantic Ocean next to Victoria Island","The Lekki Lagoon","Mangrove swamps in Badagry"],1,"Eko Atlantic sits on land reclaimed from the ocean, protected by the 'Great Wall of Lagos' sea revetment.");
  mcq(A,"easy","The headquarters of ECOWAS is in:",["Lagos","Accra","Abuja","Dakar"],2,"The ECOWAS Commission is headquartered in Abuja.");
  mcq(A,"easy","The 1999 Constitution recognises how many Local Government Areas in Nigeria?",["36","374","774","1,000"],2,"The First Schedule lists 774 LGAs.");
  mcq(A,"easy","Which agency regulates and manages water transportation in Lagos State?",["LASTMA","LASWA","LAMATA","NIWA only"],1,"The Lagos State Waterways Authority (LASWA) regulates inland waterways within the State.");
  mcq(A,"medium","Lagos State's dedicated emergency toll-free lines include 112 and:",["999","767","911","199"],1,"Lagos operates 767 alongside the national 112 emergency number.");
  tf(A,"easy","By land area, Lagos is the smallest state in Nigeria.",true,"Lagos covers roughly 3,600 km², the smallest of the 36 states, yet it is among the most populous.");
  tf(A,"medium","The Lagos State Security Trust Fund was established in 2007 to mobilise resources for security agencies in the State.",true,"The LSSTF, created by law in 2007, pools public and private funds to equip security agencies.");
  mcq(A,"easy","Nigeria's National Assembly consists of a Senate of 109 members and a House of Representatives of:",["300 members","360 members","400 members","469 members"],1,"The House of Representatives has 360 members; 109 + 360 = 469 legislators in total.");
  mcq(A,"medium","The 2025 tax reform package (Nigeria Tax Act, Nigeria Tax Administration Act and related laws) took effect from:",["1 January 2025","1 July 2025","1 January 2026","1 January 2027"],2,"The reform laws were signed in June 2025 and took effect on 1 January 2026.");
  mcq(A,"medium","The governing body of the African Union has its headquarters in:",["Abuja","Addis Ababa","Johannesburg","Nairobi"],1,"The AU Commission is headquartered in Addis Ababa, Ethiopia.");
  mcq(A,"hard","The Nigeria Data Protection Act 2023 created which regulator?",["NITDA","Nigeria Data Protection Commission","Nigerian Communications Commission","National Identity Management Commission"],1,"The NDPA established the Nigeria Data Protection Commission (NDPC), replacing the earlier NDPB.");

  /* ===================== ICT & DIGITAL GOVERNANCE ===================== */
  mcq(I,"medium","The 'CIA triad' in information security stands for:",["Control, Integrity, Audit","Confidentiality, Integrity, Availability","Cyber, Internet, Access","Compliance, Identity, Authentication"],1,"Security controls aim to keep data confidential, accurate (integrity) and accessible when needed (availability).");
  mat(I,"hard","Match each business-continuity term to its meaning.",[["RTO","Maximum acceptable time to restore a service after disruption"],["RPO","Maximum acceptable period of data loss, measured back in time"],["BIA","Analysis that ranks functions by the impact of their disruption"],["DRP","Plan for restoring IT systems after a disaster"]],"These measures drive backup frequency and recovery investment.");
  mat(I,"medium","Match each cloud service model to an example.",[["SaaS","Using hosted email or an online office suite"],["PaaS","A managed platform on which developers deploy their own apps"],["IaaS","Renting virtual servers and storage"],["On-premises","Servers owned and run in the Ministry's own data centre"]],"The more 'as a service', the less infrastructure the Ministry manages itself.");
  mcq(I,"medium","A Ministry plans to collect residents' phone numbers for a new service. The data-protection principle of 'data minimisation' requires it to:",["Collect as much data as possible in case it is useful later","Collect only the data that is adequate, relevant and necessary for the stated purpose","Store data indefinitely","Share data freely with other MDAs"],1,"Minimisation is a core principle under the NDPA 2023 and reduces breach risk.");
  mcq(I,"hard","Which combination of controls is MOST effective against ransomware crippling a Ministry's records system?",["A stronger Wi-Fi password only","Offline or immutable backups, multi-factor authentication and timely patching","Turning off antivirus to speed up PCs","Buying more storage"],1,"Layered controls prevent the attack (MFA, patching) and guarantee recovery without paying a ransom (offline backups).");
  mcq(I,"hard","A common reason digital transformation projects in government fail is:",["Using cloud services","Automating a broken manual process without redesigning it first","Training staff","Measuring outcomes"],1,"Digitising a bad process only makes it fail faster. Process re-engineering should come before automation.");
  tf(I,"easy","Two-factor authentication removes the need for strong passwords.",false,"2FA adds a layer; it does not make weak passwords acceptable.");
  ord(I,"hard","Arrange the phases of a cybersecurity incident response in order.",["Preparation","Detection and analysis","Containment","Eradication","Recovery","Post-incident review"],"This follows the widely used NIST incident-response life cycle.");
  tf(I,"medium","'Open data' policies involve publishing non-personal government datasets in machine-readable form for public reuse.",true,"Open data supports transparency and innovation; personal data must be protected or anonymised.");
  mcq(I,"medium","Which of the following is a key benefit of an integrated Enterprise Resource Planning (ERP) system in government finance and HR?",["It removes the need for budgets","It provides a single source of truth for payroll, budget and expenditure, reducing ghost workers and duplication","It replaces the Auditor-General","It eliminates all fraud automatically"],1,"An integrated ERP links HR and finance data so that controls can be automated and monitored.");
  mcq(I,"medium","Under a 'Bring Your Own Device' (BYOD) policy, the main risk a Permanent Secretary should manage is:",["Higher printing costs","Leakage of official data from unmanaged personal devices","Slower internet","Excessive use of email"],1,"BYOD needs device management, encryption and clear rules on official data.");

  /* ===================== PUBLIC POLICY & GOVERNANCE ===================== */
  ord(P,"medium","Arrange the stages of the policy cycle in the conventional order.",["Agenda setting","Policy formulation","Policy adoption / legitimation","Implementation","Evaluation"],"Issues enter the agenda, options are formulated and adopted, then implemented and evaluated. Evaluation feeds the next cycle.");
  mcq(P,"medium","Politics as 'who gets what, when, and how' is a classic definition by:",["Max Weber","Harold Lasswell","David Easton","Woodrow Wilson"],1,"Harold Lasswell (1936). Easton defined politics as the 'authoritative allocation of values'.");
  mcq(P,"hard","The 'incremental' model of policy-making, described as 'the science of muddling through', is associated with:",["Herbert Simon","Charles Lindblom","Thomas Dye","Yehezkel Dror"],1,"Lindblom argued that policy changes in small steps from existing policy, not by comprehensive redesign.");
  mcq(P,"hard","'Bounded rationality' — decision-makers 'satisfice' because of limited information and time — was developed by:",["Herbert Simon","Frederick Taylor","Henri Fayol","Elton Mayo"],0,"Simon showed that administrators seek satisfactory rather than optimal solutions.");
  mcq(P,"medium","The 'ideal type' of bureaucracy — hierarchy, written rules, impersonality and merit-based careers — was described by:",["Karl Marx","Max Weber","Woodrow Wilson","Peter Drucker"],1,"Weber's model remains the template of the classic civil service.");
  mcq(P,"medium","New Public Management (NPM) reforms typically emphasise:",["Rigid procedures over results","Managerial autonomy, performance targets, customer orientation and market mechanisms","Abolishing the civil service","Centralising all decisions in the Governor's office"],1,"NPM, influential from the 1980s, borrows private-sector tools such as contracting out and performance measurement.");
  mcq(P,"hard","The 'principal–agent problem' in governance refers to:",["Conflict between two Commissioners","The risk that agents (e.g. officials or contractors) pursue their own interests rather than those of their principals (e.g. citizens or government)","Disputes in procurement","The relationship between the PS and the Commissioner only"],1,"Information asymmetry lets agents shirk. Monitoring, incentives and transparency reduce the problem.");
  mcq(P,"hard","Public choice theory (e.g. Niskanen) predicts that, without checks, bureaucrats tend to:",["Minimise their budgets","Maximise their agency budgets","Always serve the public interest","Avoid all risk"],1,"Niskanen's budget-maximising bureaucrat explains pressure for agencies to grow.");
  mcq(P,"easy","The doctrine of separation of powers is most associated with:",["Montesquieu","Machiavelli","Hobbes","Bentham"],0,"In The Spirit of the Laws (1748), Montesquieu argued for separating legislative, executive and judicial powers.");
  mcq(P,"medium","The modern formulation of the 'rule of law' — supremacy of law, equality before the law and rights protected by courts — is credited to:",["A.V. Dicey","John Locke","Jean Bodin","Lord Denning"],0,"A.V. Dicey set out the three pillars in 1885.");
  mat(P,"hard","Match each type of evaluation to its purpose.",[["Formative evaluation","Improve a programme while it is being implemented"],["Summative evaluation","Judge overall results after completion"],["Impact evaluation","Attribute long-term changes to the programme"],["Process evaluation","Check whether activities were delivered as planned"]],"Using the right evaluation type for the question is a core M&E skill.");
  ord(P,"medium","Arrange the elements of a programme 'results chain' (logic model) in order.",["Inputs","Activities","Outputs","Outcomes","Impact"],"Resources fund activities, which produce outputs, which lead to outcomes and, over time, impact.");
  mcq(P,"medium","In an education programme, which is an OUTCOME rather than an output?",["Number of teachers trained","Number of classrooms built","Improvement in pupils' examination pass rates","Number of textbooks distributed"],2,"Outputs are the direct products of activities; outcomes are the changes they produce in beneficiaries.");
  mcq(P,"medium","On a stakeholder power/interest grid, a stakeholder with HIGH power and HIGH interest should be:",["Monitored with minimum effort","Kept informed","Kept satisfied","Managed closely / engaged fully"],3,"Key players need close engagement. High-power, low-interest stakeholders are 'kept satisfied'.");
  mat(P,"hard","Match each PPP model to its description.",[["Build-Operate-Transfer (BOT)","Private partner builds and operates the asset, then transfers it to government"],["Concession","Private operator runs an existing public asset for a fixed period, earning user fees"],["Management contract","Private firm manages a public service for a fee, with little capital investment"],["Lease","Private operator rents the asset and bears the operating risk"]],"PPP models differ in how investment, risk and ownership are shared.");
  mcq(P,"medium","Which Lagos State Government office coordinates public–private partnership projects?",["Office of Public-Private Partnerships","Ministry of Information","Lagos State Lotteries Board","Office of Establishments"],0,"The Office of PPP structures and manages PPP projects for the State.");
  mcq(P,"medium","Under the 1999 Constitution, which item is on the Exclusive Legislative List (federal only)?",["Defence","Primary education","Markets","Agriculture"],0,"Defence is exclusive to the National Assembly. Markets and agriculture are residual or local matters.");
  mcq(P,"medium","Matters not on the Exclusive or Concurrent Legislative Lists are called residual matters. Laws on them are made by:",["The National Assembly only","State Houses of Assembly","The Federal Executive Council","Local Governments only"],1,"Residual matters belong to the states.");
  mcq(P,"hard","The main purpose of a Regulatory Impact Assessment (RIA) is to:",["Measure staff attendance","Systematically weigh the likely costs, benefits and risks of a proposed regulation and its alternatives before adopting it","Audit financial statements","Rank Ministries"],1,"RIA brings evidence to rule-making and helps avoid unintended burdens.");
  mcq(P,"hard","For establishing whether a policy CAUSED an observed change, the strongest evaluation design is usually:",["An anecdotal case study","A before-and-after comparison of one group","A randomised controlled trial with a comparable control group","A stakeholder opinion poll"],2,"Randomisation balances other factors, isolating the policy's causal effect.");
  mcq(P,"medium","SERVICOM, introduced in Nigeria's public service in 2004, stands for:",["Service Commission","Service Compact with All Nigerians","Servants' Committee","Service Communication"],1,"SERVICOM commits MDAs to service charters and to quality, timely service.");
  mat(P,"hard","Match each form of decentralisation to its meaning.",[["Deconcentration","Shifting workload to field offices of the same central agency"],["Devolution","Transferring authority to autonomous sub-national governments"],["Delegation","Transferring responsibility to semi-autonomous agencies"],["Divestment","Transferring functions to the private sector"]],"The forms differ in how much authority actually leaves the centre.");
  tf(P,"easy","The 'implementation gap' is the difference between what a policy intends and what is actually delivered.",true,"Weak capacity, poor coordination, resistance or under-funding widen the gap.");
  mcq(P,"medium","Policy instruments are often grouped as 'carrots, sticks and sermons'. These correspond to:",["Incentives, regulation and information/persuasion","Taxes, prisons and churches","Budgets, audits and reports","Grants, loans and bonds"],0,"Economic incentives, regulatory compulsion and information campaigns.");
  mcq(P,"hard","Residents enjoy a clean environment whether or not they pay sanitation levies, so many do not pay. This illustrates:",["Economies of scale","The free-rider problem","Moral hazard","Diminishing returns"],1,"Non-excludable public goods invite free-riding. Collective provision and enforcement are needed.");

  /* ===================== LEADERSHIP, STRATEGY & SITUATIONAL JUDGEMENT ===================== */
  mcq(M,"hard","SITUATION: A Director repeatedly submits reports late, citing workload. As Permanent Secretary, your BEST first step is to:",["Issue a query immediately","Hold a private discussion to understand the causes, agree clear deadlines and support, and document the agreement","Reassign all their work to another Director","Ignore it, as Directors are senior"],1,"Effective leaders diagnose before sanctioning. Documented expectations also create a fair basis for formal action if performance does not improve.");
  mcq(M,"hard","SITUATION: Your Commissioner verbally instructs you to approve payment for an item not provided for in the budget. You should:",["Approve it, since the Commissioner is the political head","Advise in writing on the financial regulations, and decline until lawful authority (virement or supplementary appropriation) is obtained","Pay from another Ministry's account","Resign immediately"],1,"As Accounting Officer you are personally accountable. Give candid written advice and follow due process, respectfully.");
  mcq(M,"hard","SITUATION: Details of a draft policy still before the Executive Council appear in a newspaper. The most appropriate response is to:",["Deny everything publicly","Initiate an inquiry in line with the rules, coordinate an authorised response, and tighten information-handling controls","Punish the most junior staff on the file","Withdraw the policy"],1,"Protect due process, avoid scapegoating and fix the control weakness.");
  mcq(M,"hard","SITUATION: Two Directors disagree openly, and the conflict is delaying a flagship project. The approach most likely to produce a lasting solution is to:",["Side with the more senior Director","Bring them together, clarify shared objectives and roles, and facilitate a collaborative solution","Transfer both","Wait for the conflict to resolve itself"],1,"A collaborating (problem-solving) approach addresses the underlying issues while preserving working relationships.");
  mcq(M,"medium","SITUATION: After a contract is awarded, the contractor sends you an expensive 'appreciation' gift. You should:",["Accept it, because the award was already made","Decline it, record the offer and report it in line with the Code of Conduct","Pass it to a subordinate","Accept and declare it later if asked"],1,"Gifts connected with official acts are prohibited. Declining and reporting protects you and the process.");
  mcq(M,"hard","SITUATION: Mid-year, your Ministry's capital release is cut by 20%. The BEST approach is to:",["Cut every project by exactly 20%","Re-prioritise around the core mandate, statutory commitments and projects near completion, and agree the revised plan with stakeholders","Suspend all projects","Ignore the cut and keep awarding contracts"],1,"Strategic prioritisation beats across-the-board cuts. Finishing near-complete projects avoids abandoned assets.");
  mcq(M,"medium","SITUATION: Staff are resisting a new electronic filing system. Which approach is MOST likely to succeed?",["Mandate it and sanction non-users immediately","Explain why the change is needed, train staff, enlist respected champions and show early wins","Run the old and new systems in parallel indefinitely","Abandon the system"],1,"Change management theory (e.g. Kotter) stresses urgency, guiding coalitions, communication and short-term wins.");
  mcq(M,"hard","SITUATION: A junior officer petitions you alleging sexual harassment by a Director. The appropriate action is to:",["Ask the Director to investigate it","Ensure confidentiality, protect the complainant from retaliation, and refer the matter for impartial investigation under the applicable policy","Advise the complainant to drop it","Transfer the complainant"],1,"Fair, confidential, independent handling protects both parties' rights and the integrity of the service.");
  mcq(M,"hard","SITUATION: You discover that a well-liked Director has been inflating fuel claims by small amounts for months. You should:",["Overlook it because the amounts are small","Ensure the facts are verified and initiate the disciplinary process, including recovery, regardless of the officer's popularity","Discuss it at a general staff meeting","Ask the Director to resign quietly with full benefits"],1,"Integrity requires consistent enforcement. Tolerating 'small' fraud normalises misconduct.");
  mcq(M,"medium","SITUATION: You are new as Permanent Secretary of a Ministry with low morale. In your first month, the MOST valuable step is usually to:",["Announce a major restructuring at once","Listen widely: meet staff and stakeholders, review performance data and identify quick wins and root problems","Replace all Directors","Increase working hours"],1,"Early diagnosis builds credibility and avoids costly mistakes.");
  mcq(M,"medium","In Kotter's eight-step model of leading change, the FIRST step is to:",["Create short-term wins","Establish a sense of urgency","Anchor new approaches in the culture","Form a guiding coalition"],1,"Kotter argues that change fails without first establishing urgency.");
  ord(M,"easy","Arrange Kurt Lewin's three stages of change in order.",["Unfreeze","Change (move)","Refreeze"],"First unsettle the status quo, then implement the change, then stabilise it as the new norm.");
  ord(M,"medium","Arrange Tuckman's stages of team development in order.",["Forming","Storming","Norming","Performing","Adjourning"],"Teams typically pass through these stages. Leaders adapt their style at each stage.");
  mcq(M,"medium","In Herzberg's two-factor theory, which is a 'hygiene factor' rather than a 'motivator'?",["Recognition","Achievement","Working conditions and salary","Responsibility"],2,"Hygiene factors prevent dissatisfaction but do not motivate. Motivators include achievement, recognition and the work itself.");
  mcq(M,"medium","McGregor's 'Theory Y' assumes that employees:",["Dislike work and must be coerced","Can be self-directed and seek responsibility under the right conditions","Are motivated only by money","Avoid all responsibility"],1,"Theory Y supports participative management; Theory X assumes the opposite.");
  mcq(M,"easy","At the top of Maslow's hierarchy of needs is:",["Safety","Esteem","Self-actualisation","Belonging"],2,"Maslow's order: physiological, safety, love/belonging, esteem, self-actualisation.");
  mcq(M,"medium","The principle that each employee should receive orders from only one superior is Fayol's principle of:",["Unity of direction","Unity of command","Scalar chain","Centralisation"],1,"Unity of command prevents conflicting instructions. Unity of direction means one plan for activities with the same objective.");
  mcq(M,"medium","'Span of control' refers to:",["The duration of a project","The number of subordinates who report directly to a manager","The budget a manager controls","The geographical area of a Ministry"],1,"Spans that are too wide overload supervision; spans that are too narrow create needless layers.");
  mcq(M,"medium","A leader who inspires followers with a compelling vision, stimulates them intellectually and gives individual attention is described as:",["Transactional","Laissez-faire","Transformational","Autocratic"],2,"Transformational leadership (Burns, Bass) goes beyond exchanging rewards for compliance.");
  mcq(M,"hard","Under Hersey and Blanchard's situational leadership model, the most appropriate style for a highly competent and highly committed Director is:",["Directing / telling","Coaching / selling","Supporting / participating","Delegating"],3,"Mature, able and willing followers need little direction or support; the leader delegates.");
  mcq(M,"medium","Which is NOT one of the four perspectives of the Balanced Scorecard?",["Financial","Customer","Internal business processes","Political patronage"],3,"The four perspectives are financial, customer, internal processes, and learning and growth.");
  tf(M,"easy","In a SWOT analysis, Strengths and Weaknesses are internal factors, while Opportunities and Threats are external.",true,"SWOT separates what the organisation controls (internal) from its environment (external).");
  sa(M,"easy","In a PESTLE analysis, what does the 'L' stand for?",["legal","law"],"PESTLE = Political, Economic, Social, Technological, Legal, Environmental.");
  mat(M,"medium","Match each letter of a SMART objective to its meaning.",[["S","Specific"],["M","Measurable"],["A","Achievable"],["T","Time-bound"]],"(R = Relevant.) SMART objectives make performance contracts enforceable.");
  mat(M,"hard","Match each quadrant of the Eisenhower (urgent/important) matrix to the right action.",[["Urgent and important","Do it now"],["Important, not urgent","Schedule it"],["Urgent, not important","Delegate it"],["Neither urgent nor important","Eliminate it"]],"Senior managers should protect time for 'important, not urgent' work such as strategy and people development.");
  mcq(M,"medium","A cohesive committee suppresses dissent and reaches a poor decision to preserve harmony. This is:",["Groupthink","Synergy","Brainstorming","Delphi technique"],0,"Irving Janis's 'groupthink'. Remedies include a devil's advocate and inviting outside views.");
  mcq(M,"hard","In the Thomas–Kilmann model, the conflict style that is high in both assertiveness and cooperativeness is:",["Competing","Avoiding","Compromising","Collaborating"],3,"Collaborating seeks a win–win solution that fully satisfies both parties' concerns.");
  mcq(M,"medium","Which is NOT one of Goleman's components of emotional intelligence?",["Self-awareness","Self-regulation","Empathy","Technical expertise"],3,"Goleman's five components: self-awareness, self-regulation, motivation, empathy and social skill.");
  mcq(M,"hard","According to Mintzberg, when a manager responds to a sudden crisis such as a strike or a fire, the role played is:",["Figurehead","Disturbance handler","Monitor","Spokesperson"],1,"'Disturbance handler' is one of Mintzberg's four decisional roles.");
  mcq(M,"hard","Four risks are scored as Likelihood × Impact on 1–5 scales: A (4×3), B (2×5), C (5×3), D (3×3). Which should be treated as the highest priority?",["A","B","C","D"],2,"Scores: A = 12, B = 10, C = 15, D = 9. C has the highest risk rating.");
  mcq(M,"medium","The Pareto principle suggests that:",["All causes contribute equally","Roughly 80% of effects come from 20% of causes","Work expands to fill the time available","People rise to their level of incompetence"],1,"Focusing on the 'vital few' causes (e.g. of complaints or delays) yields the largest gains.");
  mcq(M,"medium","'In a hierarchy, every employee tends to rise to their level of incompetence' is known as:",["Parkinson's Law","The Peter Principle","Murphy's Law","The Hawthorne effect"],1,"The Peter Principle (Laurence J. Peter) argues for competence-based promotion and development.");
  mcq(M,"medium","'Work expands so as to fill the time available for its completion' is:",["Parkinson's Law","The Peter Principle","Gresham's Law","Say's Law"],0,"Parkinson's Law; clear deadlines counter it.");
  mcq(M,"hard","₦3bn has already been spent on a stalled project. Completing it needs ₦2bn more and will yield benefits worth ₦1.5bn. The economically rational decision is:",["Complete it, because ₦3bn has already been spent","Do not complete it on these figures: the ₦3bn is sunk, and ₦2bn of new spending yields only ₦1.5bn","Spend another ₦3bn","Split the cost with another Ministry"],1,"Sunk costs are irrelevant to future decisions. Continuing would destroy ₦0.5bn of value (ignoring any salvage or non-financial benefits).");
  tf(M,"easy","Succession planning is the deliberate identification and development of officers to fill key positions in future.",true,"With directors retiring at 60/35, succession planning protects institutional memory and continuity.");
  ord(M,"medium","Arrange the stages of a strategic planning process in order.",["Environmental scan (e.g. SWOT/PESTLE)","Define the vision and mission","Set strategic objectives","Design strategies and initiatives","Implement","Monitor and evaluate"],"Strategy flows from analysis to direction, objectives, action and review.");
  mcq(M,"hard","A Permanent Secretary wants Directors to own their departments' targets. The most effective mechanism is:",["Targets imposed without discussion","Signed performance contracts with SMART targets agreed with each Director and reviewed quarterly","Annual verbal reminders","Linking targets to attendance only"],1,"Negotiated, measurable and regularly reviewed targets create accountability and ownership.");
  mcq(M,"medium","Which practice BEST reflects 'servant leadership'?",["Leading by fear","Putting the growth and well-being of staff and the people served first","Avoiding decisions","Centralising all authority"],1,"Servant leadership (Greenleaf) focuses on serving followers and stakeholders.");
  return out;
})();


/* ==================== inlined from cbt-bank-law-enforcement.js ==================== */
/* ============================================================
   LAW ENFORCEMENT — question banks
   (browser: <script src>; Apps Script: paste as "cbt-bank-law-enforcement.gs")

   SEED_LE_GENERAL  → "GROUP: Law Enforcement (all enforcement cadres)"
                       seen by every enforcement cadre below
   SEED_TRAFFIC     → Traffic Management Officer Cadre (LASTMA)
   SEED_VIO         → Vehicle Inspection Officer Cadre (VIS)
   SEED_ENV         → Environmental & Special Offences Enforcement Cadre
   SEED_LNSC        → Neighbourhood Safety Corps Cadre (LNSC)

   Penalty amounts in Lagos traffic law have been amended and reported
   inconsistently, so questions test principles and procedure rather than
   fine amounts. Re-check statutory details against the current Lagos State
   Transport Sector Reform Law before an exam.
   ============================================================ */
function _cbtBankBuilder(scope,out){
  function add(c,d,type,stem,extra,ex){var q={scope:scope,category:c,type:type,difficulty:d,stem:stem,explanation:ex};for(var k in extra)q[k]=extra[k];out.push(q);}
  return {
    mcq:function(c,d,stem,o,a,ex){add(c,d,"mcq",stem,{options:o,answer:a},ex);},
    tf:function(c,d,stem,a,ex){add(c,d,"truefalse",stem,{answer:a},ex);},
    sa:function(c,d,stem,acc,ex){add(c,d,"shortanswer",stem,{accept:acc},ex);},
    ord:function(c,d,stem,items,ex){add(c,d,"ordering",stem,{items:items},ex);},
    mat:function(c,d,stem,pairs,ex){add(c,d,"matching",stem,{pairs:pairs.map(function(p){return {l:p[0],r:p[1]};})},ex);}
  };
}

/* ===================== SHARED: ALL ENFORCEMENT CADRES ===================== */
var SEED_LE_GENERAL=(function(){
  var out=[],b=_cbtBankBuilder("GROUP: Law Enforcement (all enforcement cadres)",out);
  var LE="Law Enforcement Practice",Q="Quantitative",L="Logic",E="English and Grammar";
  b.mcq(LE,"medium","Under section 35 of the 1999 Constitution, a person arrested on reasonable suspicion of an offence must be brought before a court within one day where a court of competent jurisdiction is within a radius of:",["10 km","20 km","40 km","100 km"],2,"Section 35(5): one day where a court is within 40 km; otherwise two days or such longer period as the court considers reasonable.");
  b.mcq(LE,"medium","Section 34 of the Constitution guarantees the right to dignity of the human person. Which act by an enforcement officer clearly violates it?",["Politely asking a suspect for identification","Subjecting a suspect to torture or inhuman or degrading treatment","Writing a report on an incident","Issuing an offence notice"],1,"Section 34 prohibits torture and inhuman or degrading treatment. The Anti-Torture Act 2017 makes torture a criminal offence.");
  b.tf(LE,"easy","Under the Constitution, every person charged with a criminal offence is presumed innocent until proved guilty.",true,"Section 36(5). Officers must not treat suspects as convicts.");
  b.mcq(LE,"hard","An officer arrests a suspect's brother because the suspect cannot be found. Under modern criminal-justice law (e.g. ACJA 2015 and the Lagos ACJL) this is:",["Lawful if the brother is an adult","Prohibited — arrest in lieu of a suspect is not allowed","Allowed for traffic offences","Allowed with a supervisor's approval"],1,"No person may be arrested in place of a suspect. Officers who do so face disciplinary and legal consequences.");
  b.mcq(LE,"hard","Under the Lagos State Administration of Criminal Justice Law, a confessional statement by a suspect should be recorded:",["In any manner the officer chooses","On video, or in writing in the presence of a legal practitioner of the suspect's choice","Only orally","After the trial begins"],1,"These safeguards protect the voluntariness and admissibility of confessions.");
  b.mcq(LE,"medium","Under the Evidence Act 2011, a party tendering a computer-generated document (e.g. a CCTV print-out) is generally required to:",["Do nothing extra","Provide a certificate of authentication as required by section 84","Get the defendant's consent","Translate it"],1,"Section 84 sets the conditions for the admissibility of electronic evidence, usually including a certificate.");
  b.mcq(LE,"medium","The internationally recognised principles governing the use of force by law-enforcement officers are:",["Speed, surprise and strength","Legality, necessity, proportionality and accountability","Rank, seniority and discretion","Deterrence and retribution"],1,"Force must have a lawful basis, be necessary, be proportionate to the threat, and be accounted for.");
  b.mcq(LE,"easy","A member of the public verbally abuses an officer during enforcement. The BEST response is to:",["Retaliate with insults","Remain calm and professional, de-escalate, and record the incident","Seize the person's phone","Abandon the duty post"],1,"De-escalation preserves safety and public confidence. Professional conduct protects the officer legally.");
  b.mcq(LE,"medium","The 'chain of custody' for an exhibit refers to:",["The handcuffs used","A documented, unbroken record of who handled the exhibit, when and why, from seizure to court","The order of officers' ranks","Storage in any available office"],1,"A broken chain of custody can make evidence inadmissible or unreliable.");
  b.ord(LE,"medium","Arrange the correct sequence for handling an exhibit seized during enforcement.",["Seize the item and record where and when it was found","Label and seal the item","Enter it in the exhibit register","Hand it to the exhibit keeper against signature","Produce it in court when required"],"Every transfer is documented to preserve the chain of custody.");
  b.mcq(LE,"medium","An incident report should be written in a style that is:",["Emotive and persuasive","Factual, objective, chronological and complete","Brief, with no times or names","Based on rumours from bystanders"],1,"Reports may be tested in court. Record what was seen and done, when and by whom, without opinion.");
  b.mcq(LE,"easy","The '5Ws and H' used in report writing stand for:",["Who, What, When, Where, Why and How","Watch, Wait, Warn, Write, Win and Help","Who, Which, Whose, Whom, Why and Here","None of these"],0,"Answering these six questions makes a report complete.");
  b.ord(LE,"medium","Arrange the DRABC primary survey for a casualty in order.",["Danger — make the scene safe","Response — check consciousness","Airway — open the airway","Breathing — check for normal breathing","Circulation — check for and control severe bleeding"],"The first step is to make sure that you, bystanders and the casualty are safe from further danger.");
  b.mcq(LE,"easy","An unconscious casualty who is breathing normally and has no suspected spinal injury should be placed:",["Flat on the back with the head raised","In the recovery position","Sitting upright","Face down"],1,"The recovery position keeps the airway open and lets fluids drain.");
  b.mcq(LE,"easy","The first-aid response to severe external bleeding is to:",["Give the casualty water","Apply firm direct pressure to the wound","Apply a hot compress","Wait for an ambulance without doing anything"],1,"Direct pressure is the immediate step; elevation may help where appropriate.");
  b.tf(LE,"medium","Accepting money from a road user to waive an offence is extortion or bribery and is a serious offence, whatever the amount.",true,"Corruption destroys public trust and attracts dismissal and prosecution.");
  b.mcq(LE,"medium","A colleague regularly collects 'settlement' from offenders at a checkpoint. The professional response is to:",["Join in to avoid being isolated","Report it through the agency's official reporting or whistle-blowing channel","Ignore it","Confront the colleague publicly"],1,"Officers have a duty to report misconduct. Protected channels exist for this.");
  b.mcq(LE,"medium","When handling a crowd, the first priority of the enforcement team is to:",["Use force to disperse it at once","Assess the situation, establish communication and keep a safe exit route open","Arrest the leaders","Leave the scene"],1,"Situational assessment and communication prevent escalation. Blocked exits cause crush injuries.");
  b.mcq(LE,"medium","Body-worn cameras on enforcement officers mainly help to:",["Replace written reports","Provide an objective record of encounters, deterring misconduct and false complaints","Identify officers' locations only","Entertain the public"],1,"Recordings protect both the public and the officer, but they supplement written reports rather than replace them.");
  b.mat(LE,"medium","Match each Lagos State agency to its main function.",[["LASTMA","Traffic management and enforcement"],["LASEMA","Emergency and disaster management"],["LAWMA","Waste management"],["LASBCA","Building control and safety"]],"Inter-agency coordination is part of everyday enforcement.");
  b.mcq(LE,"easy","In Lagos, the toll-free emergency numbers include:",["112 and 767","999 and 911","123 and 456","100 and 101"],0,"112 is the national emergency number; 767 is Lagos State's emergency line.");
  b.mcq(LE,"medium","The Police Act currently in force in Nigeria, which repealed the 1943 Act, was enacted in:",["2007","2015","2020","2023"],2,"The Police Act 2020 modernised policing powers and safeguards.");
  b.mcq(LE,"medium","Sanctions under Lagos traffic and environmental laws are usually imposed after prosecution before the:",["Supreme Court","Mobile courts (e.g. the Special Offences Mobile Court) or magistrates' courts","Code of Conduct Tribunal","Federal High Court"],1,"Enforcement officers apprehend and document offences; courts impose fines, forfeiture or other penalties.");
  b.tf(LE,"medium","Many traffic and environmental offences in Lagos are treated as strict-liability offences, so the prosecution need not prove intention.",true,"Mobile-court officials describe these as strict-liability offences: committing the prohibited act is enough.");
  b.mcq(Q,"medium","An enforcement unit booked 240 offences in January and 300 in February. The percentage increase is:",["20%","25%","60%","30%"],1,"(300 − 240)/240 × 100 = 25%.");
  b.mcq(Q,"medium","A patrol team of 6 officers covers 18 km of road per shift. If 2 officers are absent and each officer covers the same distance, how many km are covered?",["12 km","14 km","9 km","6 km"],0,"Each officer covers 3 km; 4 officers cover 12 km.");
  b.sa(Q,"easy","An officer works 8-hour shifts, 5 days a week. How many hours in 4 weeks? (number only)",["160"],"8 × 5 × 4 = 160 hours.");
  b.mcq(Q,"medium","Of 500 vehicles stopped, 15% had expired documents and, of those, 40% also had faulty lights. How many vehicles had both problems?",["30","60","75","200"],0,"15% of 500 = 75; 40% of 75 = 30.");
  b.mcq(L,"medium","All officers on night duty wear reflective jackets. Officer Ade is not wearing a reflective jacket. Therefore:",["Ade is on night duty","Ade is not on night duty (assuming the rule is obeyed)","Ade is off duty entirely","Nothing follows"],1,"By contraposition: not wearing a jacket implies not on night duty, if the rule is obeyed.");
  b.mcq(L,"easy","Find the next number: 5, 10, 20, 40, ___",["60","70","80","100"],2,"Each term doubles: 40 × 2 = 80.");
  b.mcq(L,"medium","An officer faces East, turns 90° anticlockwise, then 180°. Which direction is the officer now facing?",["North","South","East","West"],1,"East → 90° anticlockwise = North → 180° = South.");
  b.mcq(E,"medium","Choose the correct sentence for an incident report.",["The suspect run away when he seen us.","The suspect ran away when he saw us.","The suspect runned away when he see us.","The suspect has ran away when he saw us."],1,"Past tense: ran, saw.");
  b.mcq(E,"medium","Which statement is FACTUAL rather than an opinion, and so suitable for a report?",["The driver looked like a criminal.","The driver was obviously drunk and arrogant.","At 14:20, the vehicle KJA 123 XY drove against traffic on Ikorodu Road.","The driver is a bad person."],2,"Reports record observable facts — time, place and action — not judgements.");
  b.mcq(E,"easy","Choose the correctly spelt word.",["Ofence","Offence","Offense","Offennce"],1,"British/Nigerian spelling: offence.");
  return out;
})();

/* ===================== TRAFFIC MANAGEMENT OFFICERS (LASTMA) ===================== */
var SEED_TRAFFIC=(function(){
  var out=[],b=_cbtBankBuilder("Traffic Management Officer Cadre (LASTMA)",out);
  var T="Road Traffic Law & Management",Q="Quantitative",L="Logic",LE="Law Enforcement Practice";
  /* --- law, institutions, offences --- */
  b.mcq(T,"easy","LASTMA stands for:",["Lagos State Transport Management Authority","Lagos State Traffic Management Authority","Lagos Area Traffic Monitoring Agency","Lagos State Transit and Mobility Authority"],1,"LASTMA = Lagos State Traffic Management Authority, set up in 2000 to manage traffic flow and enforce traffic laws.");
  b.mcq(T,"medium","The principal Lagos law that consolidated the State's road traffic and transport legislation in 2018 is the:",["Road Traffic Law 2012","Lagos State Transport Sector Reform Law 2018","National Road Traffic Regulations 2012","Federal Highways Act"],1,"The Transport Sector Reform Law 2018 consolidated earlier Lagos transport laws, including the Road Traffic Law 2012.");
  b.mcq(T,"medium","Under Lagos transport law, the sanction for driving against traffic (one-way) is notable because it includes:",["A verbal warning only","Forfeiture of the vehicle, with possible imprisonment (more severe for repeat offenders)","A small fine paid on the spot","Suspension of the road user's voter card"],1,"The law treats one-way driving as a grave offence. Courts have imposed forfeiture of vehicles; reported jail terms are longer for repeat offenders.");
  b.tf(T,"easy","Private vehicles may use the dedicated BRT corridor whenever traffic is heavy.",false,"Unauthorised vehicles in BRT lanes commit an offence and endanger BRT operations.");
  b.mcq(T,"medium","In June 2022, Lagos State banned commercial motorcycle (okada) operations in six LGAs. Which of these was among them?",["Ikeja","Epe","Badagry","Ikorodu"],0,"The six LGAs were Eti-Osa, Ikeja, Surulere, Lagos Mainland, Lagos Island and Apapa (with their LCDAs). The ban was later extended to other areas.");
  b.mcq(T,"easy","Which item is mandatory for both the rider and the passenger of a motorcycle?",["Reflective jacket","Approved safety helmet","Gloves","Rain coat"],1,"Crash helmets greatly reduce fatal head injuries; non-use is an offence.");
  b.tf(T,"easy","Using a hand-held mobile phone while driving is prohibited under Lagos traffic law.",true,"Distracted driving is a leading crash factor and an offence.");
  b.mcq(T,"medium","Which body enforces traffic rules on federal highways nationwide, alongside state traffic agencies?",["NAFDAC","Federal Road Safety Corps (FRSC)","NIMASA","NCAA"],1,"FRSC was established in 1988 for road safety administration on federal roads, working with state agencies.");
  b.mcq(T,"easy","The minimum age for obtaining a private driver's licence in Nigeria is:",["16 years","18 years","21 years","25 years"],1,"Applicants must be at least 18.");
  b.mcq(T,"medium","Which Lagos agency trains, tests and certifies drivers (including commercial drivers) to raise driving standards?",["LASDRI (Lagos State Drivers' Institute)","LASWA","LASRRA","LASEPA"],0,"LASDRI focuses on driver education and certification.");
  b.mcq(T,"medium","Which agency plans and regulates the Bus Rapid Transit system and the rail mass-transit lines in Lagos?",["LAMATA","LASTMA","LASWA","LASBCA"],0,"The Lagos Metropolitan Area Transport Authority (LAMATA) is the strategic transport planning and regulatory body.");
  b.tf(T,"medium","A traffic officer's hand signals override the indications of a traffic light at the same junction.",true,"Drivers must obey a traffic controller even when the signal shows otherwise; officers often take over during signal failure or heavy congestion.");
  b.mcq(T,"medium","When a traffic officer faces you with an arm raised vertically, palm towards you, it means:",["Proceed","Stop","Turn left","Speed up"],1,"A raised palm facing approaching traffic signals 'stop'.");
  /* --- signs, signals, rules of the road --- */
  b.mat(T,"easy","Match each sign shape/colour to its category.",[["Red-bordered triangle","Warning sign"],["Red-bordered circle","Prohibitory / regulatory sign"],["Blue circle","Mandatory (positive instruction) sign"],["Rectangle","Informative / direction sign"]],"Sign shapes let drivers understand the type of message at a glance.");
  b.mcq(T,"easy","An octagonal (eight-sided) red sign means:",["Give way","Stop","No entry","Speed limit"],1,"STOP is the only octagonal sign: stop completely at the line, then proceed when safe.");
  b.mcq(T,"easy","An inverted (downward-pointing) triangle sign means:",["Stop","Give way","Roundabout ahead","Road narrows"],1,"GIVE WAY: yield to traffic on the major road.");
  b.ord(T,"easy","Arrange the normal sequence of a traffic light after GREEN.",["Green","Amber","Red"],"Green → amber (stop if safe to do so) → red.");
  b.mcq(T,"medium","A steady AMBER light means:",["Speed up to beat the red","Stop at the stop line unless you are so close that stopping would be unsafe","Proceed with caution as normal","Turn right only"],1,"Amber warns that red is coming; it is not a signal to accelerate.");
  b.mcq(T,"medium","At a roundabout, the general rule is to give way to:",["Vehicles entering after you","Vehicles already circulating on the roundabout","Pedestrians only","Heavy vehicles only"],1,"Traffic already on the roundabout has priority.");
  b.mcq(T,"easy","At a marked zebra crossing, priority belongs to:",["Vehicles","Pedestrians on or waiting to use the crossing","Motorcycles","Whoever arrives first"],1,"Drivers must stop for pedestrians using the crossing.");
  b.mcq(T,"medium","An emergency vehicle with siren and lights approaches from behind in congested traffic. A traffic officer should:",["Ignore it","Create a clear path by directing vehicles to the side, and hold cross traffic if necessary","Stop the emergency vehicle for inspection","Direct it to join the queue"],1,"Clearing a path for ambulances, fire engines and police in emergencies saves lives.");
  b.mcq(T,"hard","Under the National Road Traffic Regulations, the speed limit for private cars on expressways is:",["80 km/h","90 km/h","100 km/h","120 km/h"],2,"Private cars: 50 km/h in built-up areas, 80 km/h on highways, 100 km/h on expressways. Lower limits apply to heavier vehicles.");
  b.mcq(T,"hard","Compared with private cars, tankers and trailers are subject to:",["The same speed limits","Higher speed limits","Lower speed limits","No speed limit"],2,"Heavy vehicles have lower limits (about 60 km/h even on expressways) because of their longer stopping distances and greater crash severity.");
  b.mcq(T,"medium","The main purpose of the speed-limiting devices the FRSC requires on commercial vehicles is to:",["Save fuel only","Cap vehicle speed electronically to reduce crashes","Track vehicle location","Count passengers"],1,"Limiters physically prevent commercial vehicles from exceeding a set speed.");
  /* --- incident & traffic management --- */
  b.ord(T,"medium","Arrange a traffic officer's response to a road crash in the correct priority order.",["Secure the scene (warning triangles, position yourself safely)","Check casualties and give first aid within your training","Call emergency services (112/767) and LASEMA if required","Divert or control traffic around the scene","Record evidence: positions, photos, witness details","Arrange towing and clear the road"],"Safety first; then life; then help; then traffic flow; then evidence; then clearance.");
  b.mcq(T,"medium","A broken-down truck blocks one lane of a busy expressway at peak hour. The best immediate action is to:",["Wait for the owner to fix it","Place warning signs well upstream, merge traffic safely into the free lane and request a tow truck","Arrest the driver","Close the whole expressway"],1,"Early warning upstream prevents secondary crashes; prompt towing restores capacity.");
  b.mcq(T,"medium","'Secondary crashes' at incident scenes are best prevented by:",["Removing warning signs quickly","Providing adequate advance warning and traffic control upstream of the scene","Allowing onlookers to slow down and watch","Parking patrol vehicles carelessly"],1,"Rubber-necking and sudden queues cause rear-end collisions upstream of incidents.");
  b.mcq(T,"medium","A traffic signal has failed at a busy junction during the rush hour. The officer should:",["Leave the junction to self-regulate","Take manual control, using clear hand signals and giving priority to the heavier flows in turns","Close all approaches","Direct all traffic to one road"],1,"Manual control should allocate green time in proportion to demand, much like a signal plan.");
  b.mcq(T,"medium","In traffic engineering, 'Level of Service F' indicates:",["Free flow","Stable flow","Forced or breakdown flow (severe congestion)","Ideal conditions"],2,"LOS A is free flow; LOS F is breakdown flow with stop-and-go queues.");
  b.mat(T,"hard","Match each traffic-flow term to its meaning.",[["Flow (volume)","Number of vehicles passing a point per unit time"],["Density","Number of vehicles per unit length of road"],["Headway","Time between successive vehicles passing a point"],["Capacity","Maximum sustainable flow a road can carry"]],"These are the fundamental variables of traffic flow.");
  b.mcq(T,"hard","Traffic flow (q), density (k) and speed (v) are related by:",["q = k + v","q = k × v","q = k ÷ v","q = v ÷ k"],1,"Flow (veh/h) = density (veh/km) × speed (km/h).");
  b.mcq(T,"medium","A 'Passenger Car Unit' (PCU) is used to:",["Count passengers per car","Express the road-space effect of different vehicle types in car equivalents","Measure fuel use","Price parking"],1,"A bus or truck takes up more road capacity than a car, so it carries a higher PCU value.");
  b.mcq(T,"medium","Which of these is a 'demand management' measure rather than a capacity increase?",["Adding a new lane","Congestion pricing or restricted access for certain vehicles at peak hours","Building a flyover","Widening a bridge"],1,"Demand management shifts or reduces trips; capacity measures add supply.");
  b.mcq(T,"medium","'Staggered working hours' for public servants help traffic mainly by:",["Increasing vehicle numbers","Spreading peak-hour demand over a longer period","Closing roads","Raising fuel prices"],1,"Flattening the peak reduces congestion on the same road capacity.");
  b.tf(T,"medium","Illegal on-street parking and roadside trading at bus stops reduce effective road capacity and are common causes of local gridlock.",true,"Each obstructed lane can cut a road's capacity sharply; clearing obstructions is a core LASTMA task.");
  b.mcq(T,"medium","Which of the following is a legitimate reason to tow a vehicle?",["The driver argued with the officer","The vehicle is illegally parked and causing obstruction, or is abandoned on the carriageway, under the applicable law","The vehicle is old","The officer wants to inspect the boot"],1,"Towing must have a legal basis and be properly documented, with the vehicle taken to an authorised yard.");
  b.mcq(T,"medium","When a vehicle is impounded, the officer must ensure that:",["Nothing is recorded","The vehicle's condition and contents are documented and the owner is given official documentation of the impoundment and release procedure","Personal items are distributed","Only cash payment is accepted on the spot"],1,"Proper documentation protects the agency from allegations and preserves evidence.");
  b.mcq(LE,"hard","A driver stopped for a traffic offence refuses to produce documents and becomes aggressive. The correct approach is to:",["Assault the driver","Stay calm, explain the offence and the driver's obligations, call for back-up if needed and follow the lawful procedure for arrest or impoundment","Damage the vehicle","Let the driver go to avoid trouble"],1,"Professional, lawful escalation protects everyone and secures a valid prosecution.");
  b.mcq(LE,"medium","A traffic officer may lawfully stop and inspect a vehicle mainly to:",["Collect personal money","Check compliance with traffic laws, such as documents, roadworthiness and safe loading","Search without reason for any item","Take the driver's phone"],1,"Stops must serve a lawful traffic-enforcement purpose and respect citizens' rights.");
  b.tf(LE,"easy","Wearing an approved uniform and identification while on enforcement duty helps the public verify that an officer is genuine.",true,"Visible identification deters impersonators and supports accountability.");
  /* --- quantitative --- */
  b.mcq(Q,"medium","A vehicle travels at 72 km/h. How far does it travel in 1 second?",["7.2 m","20 m","72 m","36 m"],1,"72 km/h = 72,000 m ÷ 3,600 s = 20 m/s.");
  b.mcq(Q,"hard","A driver travelling at 72 km/h (20 m/s) takes 1.5 seconds to react before braking. The distance covered during the reaction time is:",["15 m","20 m","30 m","45 m"],2,"Reaction distance = speed × reaction time = 20 × 1.5 = 30 m — before the brakes even engage.");
  b.mcq(Q,"hard","If braking distance is proportional to the square of speed, doubling a vehicle's speed makes its braking distance:",["Double","Triple","Four times as long","Unchanged"],2,"Braking distance ∝ v², so (2v)² = 4v².");
  b.sa(Q,"medium","A traffic count records 1,800 vehicles per hour on one lane. What is the average headway between vehicles, in seconds? (number only)",["2","2.0"],"Headway = 3,600 s ÷ 1,800 veh = 2 seconds.");
  b.mcq(Q,"hard","A road carries 600 cars, 50 buses and 40 trucks per hour. Using PCU values car = 1, bus = 3, truck = 3, the flow in PCU/h is:",["690","810","750","870"],3,"600 + (50 × 3) + (40 × 3) = 600 + 150 + 120 = 870 PCU/h.");
  b.mcq(Q,"hard","The highest 15-minute count in a peak hour is 500 vehicles, and the total hourly volume is 1,800. The Peak Hour Factor (PHF = hourly volume ÷ (4 × peak 15-min volume)) is:",["0.80","0.90","1.11","0.95"],1,"PHF = 1,800 ÷ (4 × 500) = 1,800 ÷ 2,000 = 0.90. A PHF near 1 means traffic is evenly spread across the hour.");
  b.mcq(Q,"medium","A journey of 30 km takes 1 hour 15 minutes. What is the average speed?",["20 km/h","24 km/h","25 km/h","30 km/h"],1,"1 h 15 min = 1.25 h. Speed = 30 ÷ 1.25 = 24 km/h.");
  b.mcq(Q,"medium","Crashes on a corridor fell from 80 to 60 a year after enforcement was intensified. The percentage reduction is:",["20%","25%","33%","75%"],1,"(80 − 60)/80 × 100 = 25%.");
  b.mcq(Q,"hard","A traffic signal has a 90-second cycle. The main road gets 54 seconds of green. What fraction of the cycle is green for the main road?",["0.5","0.6","0.7","0.54"],1,"54 ÷ 90 = 0.6 (60% of the cycle).");
  b.mcq(Q,"hard","Webster's formula for optimum signal cycle length is C₀ = (1.5L + 5) ÷ (1 − Y), where L is the total lost time and Y is the sum of critical flow ratios. If L = 10 s and Y = 0.6, C₀ is:",["50 s","40 s","62.5 s","75 s"],0,"C₀ = (1.5 × 10 + 5) ÷ (1 − 0.6) = 20 ÷ 0.4 = 50 s.");
  b.sa(Q,"medium","A tow truck clears an obstruction in 25 minutes. If 4 similar obstructions occur, with one tow truck working one after another, how many minutes does it take to clear them all? (number only)",["100"],"4 × 25 = 100 minutes.");
  /* --- logic --- */
  b.mcq(L,"hard","At a junction, traffic from Road A is three times as heavy as traffic from Road B. If an officer allocates 80 seconds of green between them in proportion to demand, Road A gets:",["40 s","53 s","60 s","20 s"],2,"Ratio 3:1 → Road A gets 3/4 × 80 = 60 s; Road B gets 20 s.");
  b.mcq(L,"medium","'All vehicles in the BRT lane without authorisation are in breach. Vehicle X is in the BRT lane and has no authorisation.' Therefore:",["X is a BRT bus","X is in breach","X is not in breach","Nothing follows"],1,"A direct application of the rule (modus ponens).");
  b.mcq(L,"medium","An officer notices that most crashes at a junction occur between 6 p.m. and 8 p.m. Which explanation would need checking FIRST before blaming speeding?",["The colour of the cars","Poor street lighting and visibility after dark","The officers' uniforms","The day of the week the survey began"],1,"The time pattern points to darkness and visibility. Good analysis tests plausible causes before assigning blame.");
  b.mcq(L,"easy","Find the next number: 10, 20, 35, 55, 80, ___",["100","105","110","120"],2,"Differences increase by 5: +10, +15, +20, +25, then +30 → 110.");
  b.tf(L,"medium","If every driver who ran the red light was booked, and Mr Bello was not booked, then Mr Bello did not run the red light (assuming the statement is true).",true,"Contrapositive reasoning: not booked → did not run the light.");
  return out;
})();

/* ===================== VEHICLE INSPECTION OFFICERS (VIS) ===================== */
var SEED_VIO=(function(){
  var out=[],b=_cbtBankBuilder("Vehicle Inspection Officer Cadre (VIS)",out);
  var V="Vehicle Inspection & Roadworthiness",T="Road Traffic Law & Management",Q="Quantitative";
  b.mcq(V,"easy","The main role of the Vehicle Inspection Service (VIS) is to:",["Sell vehicles","Test and certify the roadworthiness of vehicles and enforce vehicle safety standards","Build roads","Issue passports"],1,"VIS ensures that only safe vehicles are on the road and that drivers are properly tested.");
  b.mcq(V,"easy","The document issued after a vehicle passes inspection is the:",["Proof of Ownership","Certificate of Roadworthiness","Insurance certificate","Hackney permit"],1,"The Certificate of Roadworthiness confirms the vehicle met inspection standards on the test date.");
  b.mcq(V,"medium","Third-party motor insurance for vehicles used on public roads in Nigeria is:",["Optional","Compulsory under the Insurance Act","Only for commercial vehicles","Only for new vehicles"],1,"Third-party insurance is compulsory; it protects victims of crashes caused by the insured vehicle.");
  b.mat(V,"medium","Match each vehicle document to its purpose.",[["Vehicle licence","Annual authority to use the vehicle on public roads"],["Proof of Ownership Certificate","Evidence of who owns the vehicle"],["Certificate of Roadworthiness","Confirms the vehicle passed inspection"],["Insurance certificate","Evidence of cover for third-party liability"]],"Officers check that each document is valid and matches the vehicle.");
  b.mcq(V,"medium","A Vehicle Identification Number (VIN) on modern vehicles normally has:",["10 characters","12 characters","17 characters","20 characters"],2,"The standard VIN has 17 characters and uniquely identifies a vehicle. Officers compare it with the documents to detect stolen or cloned vehicles.");
  b.mcq(V,"hard","During inspection, the VIN on the chassis does not match the one on the vehicle documents. The officer should:",["Approve the vehicle","Detain the vehicle and documents and refer the case for investigation (possible theft or cloning)","Correct the documents by hand","Collect a fine and release the vehicle"],1,"A VIN mismatch is a red flag for theft, smuggling or fraud and requires investigation.");
  b.mcq(V,"medium","The commonly accepted minimum legal tread depth for car tyres is:",["0.5 mm","1.0 mm","1.6 mm","3.0 mm"],2,"Below 1.6 mm grip and water-dispersal fall sharply, especially in rain.");
  b.mcq(V,"hard","The DOT code on a tyre sidewall ends with '2319'. This means the tyre was manufactured in:",["The 23rd week of 2019","19 March 2023","2023, batch 19","Week 19 of 2023"],0,"The last four digits give the week (23) and year (19) of manufacture. FRSC advises against using tyres more than about four years after manufacture.");
  b.mcq(V,"easy","Which of these is a required safety item to be carried in a vehicle?",["Extra seat covers","Fire extinguisher","Car perfume","Decorative lights"],1,"A fire extinguisher, a warning (C-caution) triangle, a spare tyre and a first-aid box are basic required items.");
  b.mcq(V,"easy","The 'C-caution' (warning triangle) is used to:",["Decorate the car","Warn approaching traffic of a stationary or broken-down vehicle","Measure tyre pressure","Signal a left turn"],1,"It is placed well behind a broken-down vehicle to give drivers time to react.");
  b.ord(V,"medium","Arrange a basic vehicle inspection in a logical order.",["Check the vehicle documents and VIN","External check: lights, indicators, tyres, mirrors, windscreen","Under-bonnet and under-vehicle check: leaks, steering, suspension","Brake test","Record the results and issue a pass or fail with reasons"],"A systematic order prevents omissions and produces defensible records.");
  b.mcq(V,"medium","A vehicle's footbrake pedal sinks slowly to the floor while held down. This most likely indicates:",["A good brake system","A hydraulic leak or a failing master cylinder","Low tyre pressure","A weak battery"],1,"A sinking pedal shows a loss of hydraulic pressure — an immediate fail item.");
  b.mcq(V,"medium","ABS (anti-lock braking system) helps the driver mainly by:",["Shortening every stopping distance","Preventing wheel lock-up so that steering control is kept during hard braking","Increasing engine power","Saving fuel"],1,"ABS keeps the wheels turning under heavy braking so the driver can steer around hazards.");
  b.mcq(V,"medium","Excessive play (free movement) in the steering wheel indicates:",["Normal wear only","Worn steering components, making the vehicle unsafe to drive","Good alignment","High tyre pressure"],1,"Steering defects are critical safety failures.");
  b.mcq(V,"medium","Thick black smoke from a diesel vehicle's exhaust usually points to:",["Perfect combustion","Incomplete combustion, e.g. faulty injectors or a clogged air filter, causing pollution","Coolant in the engine","A new engine"],1,"Excess smoke indicates poor engine condition and harmful emissions.");
  b.mcq(V,"medium","A catalytic converter in the exhaust system is fitted to:",["Make the car louder","Reduce harmful exhaust emissions","Increase speed","Cool the engine"],1,"It converts pollutants such as CO and NOx into less harmful gases.");
  b.tf(V,"easy","Bald tyres increase the risk of skidding and aquaplaning on wet roads.",true,"Without tread, water cannot be channelled away and the tyre loses grip.");
  b.tf(V,"medium","A vehicle with a cracked windscreen that obstructs the driver's view should fail inspection.",true,"Driver visibility is a basic safety requirement.");
  b.mcq(V,"medium","Overloading a commercial vehicle mainly causes:",["Better stability","Longer braking distances, tyre failures, loss of control and road-surface damage","Lower fuel consumption","Improved suspension"],1,"Overloading is a major crash factor and damages road pavements.");
  b.mcq(V,"medium","A tanker conveying petroleum products must display:",["Advertising stickers","Approved hazard warning placards and carry required safety equipment","Nothing special","Political posters"],1,"Hazard placards tell emergency responders what the load is and how to handle it.");
  b.mcq(V,"medium","In a Nigerian number plate such as 'KJA-123-XY', the first three letters identify:",["The vehicle make","The Local Government Area of registration","The owner's initials","The year of manufacture"],1,"The three-letter code identifies the LGA where the vehicle was registered.");
  b.mcq(V,"medium","On Nigerian number plates, private vehicles carry blue lettering. Commercial vehicles carry:",["Green lettering","Red lettering","Black lettering","Yellow lettering"],1,"Red lettering identifies commercial (hackney) vehicles.");
  b.mcq(V,"hard","During a driver's practical test, the candidate fails to check the mirrors before changing lanes. The examiner should:",["Ignore it","Record it as a fault in line with the test standard, as it is a safety-critical error","Pass the candidate anyway","Stop the test and collect money"],1,"Consistent, documented assessment is the basis of credible licensing.");
  b.mcq(V,"medium","Which agency in Lagos handles vehicle registration and the issuing of number plates and vehicle licences?",["LASEPA","Motor Vehicle Administration Agency (MVAA)","LASWA","LASPPPA"],1,"The MVAA manages vehicle registration and licensing in Lagos State.");
  b.mcq(T,"medium","A driver presents a driver's licence that appears altered. The VIO should:",["Accept it","Verify it with the licensing database or authority and, if forged, detain the document and refer the case for prosecution","Return it and warn the driver","Write a new licence"],1,"Verification protects the integrity of licensing; forgery is a criminal offence.");
  b.mcq(T,"easy","Which class of driver's licence is for motorcycles in Nigeria?",["Class A","Class B","Class E","Class G"],0,"Class A covers motorcycles. Other classes cover cars, commercial vehicles and articulated vehicles.");
  b.mcq(Q,"medium","A VIS centre inspects 45 vehicles a day, 6 days a week. How many vehicles does it inspect in 4 weeks?",["1,080","1,800","270","1,620"],0,"45 × 6 × 4 = 1,080.");
  b.mcq(Q,"medium","Of 400 vehicles inspected, 88 failed. What is the pass rate?",["22%","78%","88%","72%"],1,"Passed = 312; 312/400 = 78%.");
  b.sa(Q,"hard","A tyre was made in week 10 of 2021. Using a 4-year guideline from the date of manufacture, in which year should it be replaced? (year only)",["2025"],"2021 + 4 = 2025 (by week 10 of 2025).");
  return out;
})();

/* ===================== ENVIRONMENTAL & SPECIAL OFFENCES ENFORCEMENT ===================== */
var SEED_ENV=(function(){
  var out=[],b=_cbtBankBuilder("Environmental & Special Offences Enforcement Cadre",out);
  var LE="Law Enforcement Practice",Q="Quantitative";
  b.mcq(LE,"medium","Lagos consolidated its main environmental laws in 2017 into the:",["Environmental Sanitation Law 2000","Lagos State Environmental Management and Protection Law 2017","Federal Environmental Protection Act","National Environmental Standards Act"],1,"The 2017 Law brought environmental sanitation, waste, pollution and related provisions into one framework.");
  b.mcq(LE,"medium","Under the Lagos law prohibiting street trading and illegal markets, who commits an offence when goods are bought from a street hawker?",["Only the hawker","Only the buyer","Both the hawker and the buyer","Neither"],2,"The law penalises both the seller and the buyer, to reduce demand for street trading.");
  b.mat(LE,"medium","Match each Lagos agency to its environmental function.",[["LASEPA","Pollution control, including noise and emissions"],["LAWMA","Waste collection and disposal"],["LASBCA","Building control and structural safety"],["LASPPPA","Physical planning permits"]],"Enforcement officers must know which agency leads on each issue.");
  b.mcq(LE,"easy","Dumping refuse into a drainage channel or canal is prohibited mainly because it:",["Is untidy","Blocks the drains and causes flooding, disease and environmental damage","Is a waste of refuse","Reduces LAWMA revenue"],1,"Blocked drains are a leading cause of urban flooding in Lagos.");
  b.mcq(LE,"medium","Before removing an illegal structure on a drainage setback, due process normally requires that the enforcement team:",["Demolish it without notice","Serve the prescribed statutory notice(s), allow the stated period, and act within the law with documentation","Seize the occupant's property for sale","Act only at night"],1,"Proper notice and documentation make enforcement lawful and defensible in court.");
  b.mcq(LE,"medium","Complaints about excessive noise from places of worship, clubs or event centres in Lagos are regulated primarily by:",["LASTMA","LASEPA","LASWA","LASRRA"],1,"LASEPA sets and enforces noise standards.");
  b.mcq(LE,"easy","LAWMA's 'Blue Box' programme encourages residents to:",["Pay taxes online","Separate recyclable waste at source","Plant trees","Register vehicles"],1,"Sorting recyclables at source reduces landfill volumes and supports the recycling economy.");
  b.mcq(LE,"medium","Private Sector Participation (PSP) operators in Lagos are mainly responsible for:",["Road construction","Household and commercial waste collection under LAWMA's regulation","Water supply","Traffic control"],1,"PSP operators collect waste from premises; LAWMA regulates and manages disposal sites.");
  b.tf(LE,"easy","Open defecation and urination in public places are offences under Lagos environmental laws.",true,"They are public health offences.");
  b.mcq(LE,"hard","During a raid on illegal street traders, a crowd gathers and becomes hostile. The team leader's best action is to:",["Order the team to beat the crowd","Prioritise safety: de-escalate, communicate the lawful basis, call for police support if needed, and withdraw if the operation cannot be completed safely","Seize all goods in sight","Fire warning shots"],1,"Lawful, proportionate enforcement with a safety-first approach avoids injuries and loss of public trust.");
  b.mcq(LE,"medium","Goods seized from street traders during enforcement must be:",["Shared among officers","Recorded in an inventory, kept securely and handled according to the law and court directions","Sold on the spot","Destroyed immediately"],1,"Inventory and lawful disposal prevent theft and allegations of misconduct.");
  b.ord(LE,"medium","Arrange the steps of a planned environmental enforcement operation in order.",["Gather intelligence and identify the legal basis","Obtain approvals and brief the team","Serve notices where required","Carry out the operation lawfully","Document evidence and seizures","Prosecute offenders and report"],"Planning, legality and documentation are as important as the operation itself.");
  b.mcq(Q,"medium","An enforcement team removed 120 illegal shanties in week 1 and 30% more in week 2. How many in week 2?",["150","156","160","36"],1,"120 × 1.3 = 156.");
  b.mcq(Q,"medium","If 3 teams can clear a canal stretch in 12 days, how many days would 4 teams take, working at the same rate?",["9","16","8","10"],0,"Total work = 3 × 12 = 36 team-days; 36 ÷ 4 = 9 days.");
  return out;
})();

/* ===================== NEIGHBOURHOOD SAFETY CORPS (LNSC) ===================== */
var SEED_LNSC=(function(){
  var out=[],b=_cbtBankBuilder("Neighbourhood Safety Corps Cadre (LNSC)",out);
  var LE="Law Enforcement Practice",L="Logic";
  b.mcq(LE,"medium","The Lagos State Neighbourhood Safety Corps (LNSC) was established by law in:",["2007","2012","2016","2021"],2,"The LNSC Law was enacted in 2016 to strengthen community-level safety and intelligence.");
  b.mcq(LE,"medium","The core function of LNSC personnel is to:",["Replace the Nigeria Police","Support community safety through patrols, intelligence gathering and liaison with the police and other security agencies","Prosecute criminal cases in court","Collect taxes"],1,"LNSC complements the police at community level and does not replace them.");
  b.tf(LE,"medium","LNSC personnel are authorised to bear firearms in the course of their duties.",false,"LNSC officers are not a weapon-bearing force; armed response remains with the police and other security agencies.");
  b.mcq(LE,"easy","'Community policing' is best described as:",["Policing only by the military","A partnership between security agencies and residents to identify and solve local safety problems","Residents taking the law into their own hands","Patrols only at night"],1,"Trust and partnership improve intelligence and crime prevention.");
  b.ord(LE,"medium","Arrange the stages of the SARA problem-solving model used in community safety.",["Scanning","Analysis","Response","Assessment"],"Identify the problem, analyse its causes, respond and then assess the results.");
  b.mcq(LE,"hard","Routine activity theory says a crime is likely when three elements meet. These are:",["Poverty, unemployment and youth","A motivated offender, a suitable target and the absence of a capable guardian","Darkness, rain and holidays","Weapons, vehicles and money"],1,"Removing any one element — for example by adding a capable guardian such as patrols or lighting — prevents crime.");
  b.mcq(LE,"medium","'Crime Prevention Through Environmental Design' (CPTED) includes measures such as:",["Arresting more suspects","Good street lighting, clear sightlines and controlled access points","Longer prison terms","Higher fines"],1,"Designing spaces to increase natural surveillance deters crime.");
  b.ord(LE,"hard","Arrange the stages of the intelligence cycle in order.",["Direction / planning","Collection","Processing","Analysis","Dissemination"],"Feedback from users then refines the next cycle.");
  b.mcq(LE,"medium","Residents catch a suspected thief and start beating him. The LNSC officer should:",["Join in","Stop the jungle justice, protect the suspect, preserve evidence and hand the suspect to the police","Leave the scene","Take a video for social media only"],1,"Mob action is a crime. Suspects have a constitutional right to a fair trial.");
  b.mcq(LE,"medium","The Lagos State Security Trust Fund (LSSTF) supports security mainly by:",["Recruiting soldiers","Mobilising public and private funds to equip and support security agencies in the State","Running prisons","Issuing gun licences"],1,"Established in 2007, the LSSTF funds equipment, vehicles and logistics for security agencies.");
  b.mcq(LE,"medium","When an informant gives information about a planned robbery, the officer must:",["Publicise the informant's name","Protect the informant's identity and pass the information promptly through the proper channel","Ignore it","Confront the suspects alone"],1,"Source protection and timely reporting are key to intelligence-led prevention.");
  b.mcq(LE,"medium","The 'broken windows' theory suggests that:",["Only serious crimes matter","Visible signs of disorder, if left unaddressed, encourage more serious crime","Windows cause crime","Police should ignore minor offences"],1,"Addressing minor disorder can help prevent more serious crime, although critics warn against heavy-handed enforcement.");
  b.mcq(L,"medium","Burglaries in an estate rose sharply after street lights failed. The most reasonable FIRST response is to:",["Assume the residents are responsible","Restore the lighting and increase patrols in the affected streets, then monitor whether burglaries fall","Ban all visitors","Do nothing"],1,"The response targets the likely cause, then assessment checks whether it worked (as in SARA).");
  b.mcq(L,"easy","Find the next number: 1, 4, 9, 16, 25, ___",["30","34","36","49"],2,"Square numbers: 6² = 36.");
  return out;
})();

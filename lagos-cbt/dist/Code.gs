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
  /* New banks are merged by wording: a question is added only if no question with the same scope and
     stem exists yet, so re-running never duplicates and top-up banks can extend an existing scope.
     All additions go in one write and all flags in one config update (keeps first load fast). */
  var sigs=null,toAdd=[],flags={};
  getSeedBanks().forEach(function(b){
    if(bankDone_(cfg,b))return;
    if(!sigs){sigs={};store.readAll("Questions").forEach(function(q){sigs[q.scope+"||"+q.stem]=1;});}
    b.data.forEach(function(q){var k=q.scope+"||"+q.stem;if(!sigs[k]){sigs[k]=1;toAdd.push(q);}});
    flags["seeded_"+b.key]=true;
  });
  if(toAdd.length)appendMany_(store,"Questions",withIds_(toAdd));
  if(Object.keys(flags).length)store.setConfig(flags);
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
var FIRE_CADRE="Fire & Rescue Service Cadre (LSFRS)";
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
  if(typeof SEED_FIRE!=="undefined")b.push({key:"fire",scope:FIRE_CADRE,data:SEED_FIRE});
  if(typeof SEED_ENV_EXTRA!=="undefined")b.push({key:"env_extra_v1",scope:ENV_CADRE,data:SEED_ENV_EXTRA});
  if(typeof SEED_LNSC_EXTRA!=="undefined")b.push({key:"lnsc_extra_v1",scope:LNSC_CADRE,data:SEED_LNSC_EXTRA});
  /* professional-knowledge banks: one bank (and one seed flag) per cadre */
  [typeof SEED_PROF_ADMIN!=="undefined"?SEED_PROF_ADMIN:null,
   typeof SEED_PROF_HEALTH!=="undefined"?SEED_PROF_HEALTH:null,
   typeof SEED_PROF_WORKS!=="undefined"?SEED_PROF_WORKS:null,
   typeof SEED_PROF_SCIENCE!=="undefined"?SEED_PROF_SCIENCE:null,
   typeof SEED_PROF_FINANCE!=="undefined"?SEED_PROF_FINANCE:null].forEach(function(map){
    if(!map)return;
    for(var name in map)b.push({key:"prof_"+name.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,""),scope:name,data:map[name]});
  });
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
{"name": "Neighbourhood Safety Corps Cadre (LNSC)", "levels": [{"gl": "04", "post": "Corps Member"}, {"gl": "05", "post": "Senior Corps Member"}, {"gl": "06", "post": "Assistant Safety Officer"}, {"gl": "07", "post": "Safety Officer II"}, {"gl": "08", "post": "Safety Officer I"}, {"gl": "09", "post": "Senior Safety Officer"}, {"gl": "10", "post": "Principal Safety Officer"}, {"gl": "12", "post": "Assistant Chief Safety Officer"}, {"gl": "13", "post": "Chief Safety Officer"}, {"gl": "14", "post": "Assistant Director (Neighbourhood Safety)"}]},
{"name": "Fire & Rescue Service Cadre (LSFRS)", "levels": [{"gl": "04", "post": "Fireman / Firewoman"}, {"gl": "05", "post": "Leading Firefighter"}, {"gl": "06", "post": "Sub-Officer"}, {"gl": "07", "post": "Station Officer II"}, {"gl": "08", "post": "Station Officer I"}, {"gl": "09", "post": "Assistant Divisional Officer"}, {"gl": "10", "post": "Divisional Officer"}, {"gl": "12", "post": "Senior Divisional Officer"}, {"gl": "13", "post": "Assistant Chief Fire Officer"}, {"gl": "14", "post": "Deputy Chief Fire Officer"}, {"gl": "15", "post": "Chief Fire Officer"}, {"gl": "16", "post": "Deputy Director (Fire and Rescue Services)"}, {"gl": "17", "post": "Director (Fire and Rescue Services)"}]}
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

/* ===================== FIRE & RESCUE SERVICE (LSFRS) ===================== */
var SEED_FIRE=(function(){
  var out=[],b=_cbtBankBuilder("Fire & Rescue Service Cadre (LSFRS)",out);
  var P="Professional Knowledge",Q="Quantitative",LE="Law Enforcement Practice";
  b.mcq(P,"easy","The three elements of the fire triangle are:",["Smoke, flame and ash","Heat, fuel and oxygen","Water, foam and powder","Wood, paper and petrol"],1,"Remove any one element and the fire goes out. The fire tetrahedron adds the chemical chain reaction.");
  b.mat(P,"medium","Match each class of fire (European classification) to its fuel.",[["Class A","Ordinary solids such as wood, paper and cloth"],["Class B","Flammable liquids such as petrol and paints"],["Class C","Flammable gases such as LPG"],["Class F","Cooking oils and fats"]],"Class D covers combustible metals. Electrical fires are treated by isolating the supply and using suitable agents.");
  b.mcq(P,"easy","A water extinguisher must NOT be used on:",["Burning paper","Burning wood","Live electrical equipment or burning oil","Burning cloth"],2,"Water conducts electricity and spreads burning liquids.");
  b.mat(P,"medium","Match each extinguisher (BS EN 3 colour band) to its agent.",[["Red","Water"],["Cream","Foam"],["Blue","Dry powder"],["Black","Carbon dioxide (CO₂)"]],"Wet chemical extinguishers carry a yellow band and are used on Class F fires.");
  b.ord(P,"easy","Arrange the PASS technique for using a portable extinguisher.",["Pull the pin","Aim at the base of the fire","Squeeze the handle","Sweep from side to side"],"Aiming at the base attacks the fuel, not the flames.");
  b.mat(P,"medium","Match each method of heat transfer to its description.",[["Conduction","Heat travelling through a solid material"],["Convection","Heat carried by moving hot gases or liquids"],["Radiation","Heat travelling as electromagnetic waves"],["Direct burning","Flame contact igniting nearby materials"]],"Understanding heat transfer guides fire attack and protection of exposures.");
  b.mcq(P,"hard","Flashover is best described as:",["A small fire in a waste bin","The near-simultaneous ignition of all combustible materials in a compartment when they reach ignition temperature","An explosion of a gas cylinder","Smoke leaving a window"],1,"Flashover is usually unsurvivable for anyone in the room.");
  b.mcq(P,"hard","Backdraught occurs when:",["Water is applied to a fire","Air (oxygen) suddenly enters an oxygen-starved compartment containing hot, unburnt fuel gases","A fire spreads by radiation","Foam is applied to petrol"],1,"Signs include smoke pulsing at openings and blackened windows.");
  b.mcq(P,"medium","Firefighters entering smoke-filled buildings wear self-contained breathing apparatus (SCBA) and are recorded by an entry control officer mainly to:",["Count equipment","Protect them from toxic gases and track who is inside and their air supply","Write a press release","Speed up the work"],1,"Entry control ensures no firefighter is left unaccounted for.");
  b.mcq(P,"medium","For safe use, an extension ladder should be pitched at an angle of about:",["45°","60°","75° (the 1-in-4 rule)","90°"],2,"The foot is about one unit out for every four units of height.");
  b.mcq(Q,"medium","A pressure of 1 bar can lift water to roughly what height?",["1 m","10 m","100 m","0.1 m"],1,"1 bar ≈ 10 m head of water (ignoring friction loss).");
  b.mcq(Q,"medium","A fire tender carries 4,500 litres of water and a branch discharges 450 litres per minute. How long will the tank supply last?",["5 minutes","10 minutes","45 minutes","100 minutes"],1,"4,500 ÷ 450 = 10 minutes — hence the need to secure a hydrant or other supply quickly.");
  b.mcq(Q,"easy","One litre of water has a mass of about:",["0.1 kg","1 kg","10 kg","100 kg"],1,"A 4,500-litre tender therefore carries about 4.5 tonnes of water.");
  b.ord(P,"medium","Arrange the RACE response to a fire in a building.",["Rescue people in immediate danger","Alarm — raise the alarm and call 112/767","Confine — close doors to contain the fire","Extinguish or evacuate"],"Life safety comes first.");
  b.mcq(P,"medium","On a hazardous-materials placard, the four-digit UN number identifies:",["The driver","The specific dangerous substance being carried","The vehicle's registration","The emergency phone number"],1,"Responders use it to look up the hazards and the correct response.");
  b.mcq(P,"medium","At a multiple-casualty incident using START triage, casualties who can walk are tagged:",["Red (immediate)","Yellow (delayed)","Green (minor)","Black (deceased/expectant)"],2,"Walking wounded are directed to a collection point.");
  b.mcq(P,"medium","Which Lagos agency coordinates disaster response, such as building collapses, together with the fire service?",["LASEMA","LASTMA","LIRS","LAWMA"],0,"The Lagos State Emergency Management Agency coordinates multi-agency response.");
  b.mcq(P,"medium","Lagos State's agency responsible for promoting occupational and public safety standards, including safety in public buildings, is the:",["Lagos State Safety Commission","Lagos State Lotteries Board","LASRRA","LASWA"],0,"Fire safety inspections and safety standards complement fire-service operations.");
  b.mcq(P,"medium","In fire investigation, a 'V-pattern' burn mark on a wall usually points towards the:",["Firefighters' entry point","Area of origin of the fire","Exit door","Water supply"],1,"Fire rises and spreads outwards, leaving a V shape above the origin.");
  b.mcq(P,"easy","A person whose clothes catch fire should:",["Run for help","Stop, drop and roll","Fan the flames","Jump into a car"],1,"Running feeds the fire with oxygen.");
  b.mcq(P,"medium","On arrival at a house with a strong smell of cooking gas (LPG) but no fire, crews should:",["Switch on lights to see better","Avoid ignition sources (no switches or naked flames), shut off the cylinder valve if safe, ventilate and evacuate","Light a match to find the leak","Close all windows"],1,"LPG is heavier than air and collects at low levels.");
  b.mcq(P,"hard","Halon extinguishers have largely been phased out because halons:",["Are too cheap","Deplete the ozone layer","Do not work on any fire","Are too heavy"],1,"They are controlled under the Montreal Protocol.");
  b.tf(P,"easy","Regular fire drills help occupants learn escape routes and assembly points.",true,"Drills reduce panic and evacuation time.");
  b.tf(P,"medium","Fire doors may be wedged open to improve ventilation in offices.",false,"Fire doors must close to stop the spread of fire and smoke.");
  b.tf(P,"medium","Smoke inhalation causes more fire deaths than burns.",true,"Toxic gases such as carbon monoxide incapacitate quickly.");
  b.sa(P,"easy","Name the three sides of the fire triangle (e.g. 'heat fuel oxygen').",["heat fuel oxygen","heat, fuel, oxygen","fuel heat oxygen","oxygen heat fuel","heat fuel and oxygen"],"Fire needs all three to burn.");
  b.mcq(LE,"medium","At a fire scene, crowd control by the fire service and police is important mainly to:",["Entertain onlookers","Keep people safe, protect access for appliances and prevent interference and looting","Collect fees","Film the incident"],1,"Cordons protect the public and emergency workers.");
  return out;
})();

/* ===================== TOP-UPS (added to existing scopes) ===================== */
var SEED_ENV_EXTRA=(function(){
  var out=[],b=_cbtBankBuilder("Environmental & Special Offences Enforcement Cadre",out);
  var LE="Law Enforcement Practice",Q="Quantitative";
  b.mcq(LE,"easy","Before taking enforcement action against a member of the public, an officer should:",["Act without identifying themselves","Identify themselves, show official identification and state the offence","Wear civilian clothes to avoid recognition","Demand money"],1,"Identification builds legitimacy and protects against impersonators.");
  b.mcq(Q,"medium","A 7-day abatement notice is served on Monday, 3 March. On which date does the notice period end?",["Monday, 10 March","Sunday, 9 March","Thursday, 6 March","Monday, 17 March"],0,"Counting 7 days from 3 March gives 10 March (check the exact counting rule in the relevant law).");
  b.mcq(LE,"medium","Photographs taken as evidence of an environmental offence should show:",["Only the officer","The date, time and location, with the offence clearly visible","Unrelated people","Edited images"],1,"Authentic, well-documented evidence supports prosecution at the mobile court.");
  b.mcq(LE,"medium","Shanties and illegal structures under bridges are cleared mainly because they:",["Look untidy only","Create safety, health and security risks and can damage public infrastructure","Pay no rent","Block the view"],1,"Clearance should follow due process and, where possible, welfare referrals.");
  b.tf(LE,"medium","Officers may keep part of the goods seized from street traders as a reward.",false,"Seized goods are exhibits and must be recorded and handled according to law.");
  b.mcq(LE,"medium","An offender arrested for an environmental offence is usually charged before the:",["Supreme Court","Mobile court or magistrates' court with jurisdiction","Code of Conduct Tribunal","Customary court only"],1,"Mobile courts hear environmental and traffic offences quickly.");
  return out;
})();
var SEED_LNSC_EXTRA=(function(){
  var out=[],b=_cbtBankBuilder("Neighbourhood Safety Corps Cadre (LNSC)",out);
  var LE="Law Enforcement Practice";
  b.ord(LE,"medium","Arrange the key details to obtain when receiving a distress call.",["Exact location","Nature of the emergency","Number of people involved or injured","Caller's name and call-back number","Dispatch help and give safety advice"],"Location first, so help can be sent even if the call drops.");
  b.mcq(LE,"easy","Neighbourhood patrols are safest and most effective when officers:",["Patrol alone without communication","Patrol in pairs or teams with a means of communication","Patrol only in daylight once a week","Announce their exact route in advance"],1,"Teams with radios can call for support quickly.");
  b.mcq(LE,"medium","A suspect apprehended by LNSC personnel should be:",["Detained in a private house overnight","Handed over promptly to the police with a written report","Released after a fine paid to the officer","Beaten as a deterrent"],1,"LNSC complements the police; custody and prosecution are police functions.");
  b.mcq(LE,"medium","A resident reports domestic violence next door. The LNSC officer should:",["Ignore it as a family matter","Ensure immediate safety, then refer to the police and the Domestic and Sexual Violence Agency","Settle it with the abuser privately for money","Post it online"],1,"Domestic violence is a crime; survivors need protection and support.");
  b.mcq(LE,"easy","Regular meetings with residents, CDAs and community leaders help the LNSC mainly to:",["Collect levies","Build trust and gather information on local safety concerns","Replace the police","Settle land disputes"],1,"Community trust drives intelligence-led prevention.");
  b.tf(LE,"medium","Information received from residents about suspected crime should be treated as confidential and passed through the proper channel.",true,"Protecting sources encourages reporting.");
  return out;
})();


/* ==================== inlined from cbt-bank-prof-admin.js ==================== */
/* ============================================================
   PROFESSIONAL KNOWLEDGE — administrative, executive, clerical,
   secretarial, stores, library, education, catering and support cadres.
   20 questions per cadre. Shared file (browser + Apps Script).
   ============================================================ */
var SEED_PROF_ADMIN=(function(){
  var out={},cur=null,C="Professional Knowledge",E="easy",M="medium",H="hard";
  function cadre(n){cur=out[n]=[];}
  function q(t,d,stem,x,ex){var o={scope:null,category:C,type:t,difficulty:d,stem:stem,explanation:ex};for(var k in x)o[k]=x[k];cur.push(o);}
  function m(d,stem,o,a,ex){q("mcq",d,stem,{options:o,answer:a},ex);}
  function t(d,stem,a,ex){q("truefalse",d,stem,{answer:a},ex);}
  function s(d,stem,acc,ex){q("shortanswer",d,stem,{accept:acc},ex);}
  function o(d,stem,items,ex){q("ordering",d,stem,{items:items},ex);}
  function x(d,stem,pairs,ex){q("matching",d,stem,{pairs:pairs.map(function(p){return {l:p[0],r:p[1]};})},ex);}

  /* ---------------- Administrative Officer ---------------- */
  cadre("Administrative Officer Cadre");
  m(M,"The document that lists all approved posts in a Ministry, with their grade levels and the number of each, is the:",["Nominal roll","Establishment (staff establishment list)","Payroll","Organogram"],1,"The establishment shows approved posts; the nominal roll lists the actual officers in post.");
  m(M,"A list of all officers actually in post, showing name, rank, date of birth and date of first appointment, is the:",["Establishment","Nominal roll","Vote book","Gazette"],1,"The nominal roll supports staff audit, promotion and retirement planning.");
  m(H,"Comparing the establishment with the nominal roll mainly helps the Admin & HR department to identify:",["Budget surpluses","Vacancies, over-staffing and possible ghost workers","Audit queries","Court cases"],1,"Gaps show vacancies; excess shows over-establishment; unmatched names on the payroll suggest ghost workers.");
  m(M,"A Training Needs Analysis (TNA) is carried out to:",["Punish poor performers","Identify gaps between required and actual competencies before designing training","Calculate salaries","Approve leave"],1,"Training should address identified gaps, not be offered at random.");
  o(H,"Arrange Kirkpatrick's four levels of training evaluation from first to last.",["Reaction","Learning","Behaviour","Results"],"Reaction (did trainees like it?) → Learning (what did they learn?) → Behaviour (do they apply it?) → Results (organisational impact).");
  m(M,"In official files, the abbreviation 'B.U.' written on a minute means:",["Bring Up (return the file on a stated date)","Be Urgent","Basic Unit","Budget Update"],0,"'B.U. 14/3' asks the registry to bring the file back on that date.");
  x(M,"Match each security classification to its meaning.",[["Top Secret","Disclosure would cause exceptionally grave damage"],["Secret","Disclosure would cause serious damage"],["Confidential","Disclosure would be prejudicial to the interest of government"],["Restricted","Limited to official use"]],"Classified documents are handled, stored and transmitted according to their grading.");
  m(E,"The minimum number of members who must be present for a meeting to transact business validly is the:",["Agenda","Quorum","Majority","Caucus"],1,"Decisions taken without a quorum can be challenged.");
  o(M,"Arrange the usual order of items on a formal meeting agenda.",["Opening and apologies","Adoption of minutes of the last meeting","Matters arising","New business","Any other business","Date of next meeting and close"],"This standard order makes meetings predictable and well minuted.");
  m(M,"'Matters arising' on an agenda refers to:",["Brand-new issues","Follow-up on items recorded in the previous meeting's minutes","Complaints","Financial reports only"],1,"It tracks whether earlier decisions were implemented.");
  m(H,"A job description primarily states:",["The officer's personal qualities","The duties, responsibilities and reporting lines of a post","Salary history","Disciplinary record"],1,"A person specification describes the ideal holder; a job description describes the job.");
  m(M,"Manpower (workforce) planning in a Ministry is mainly concerned with:",["Purchasing vehicles","Forecasting staff requirements and matching them with supply over time","Writing press releases","Budget defence only"],1,"It covers recruitment, retirements, promotion and training needs.");
  t(E,"A grievance procedure gives officers a formal channel to raise complaints about their work or treatment.",true,"Clear grievance procedures reduce conflict and petitions.");
  t(M,"An organogram shows the structure of an organisation, including reporting relationships.",true,"It displays departments, units and lines of authority.");
  t(M,"A staff audit (head count) is only useful for promotion exercises.",false,"Staff audits also verify the payroll, detect ghost workers and update the nominal roll.");
  m(M,"A 'minute' written on a file is best described as:",["A 60-second meeting","A written note on a minute sheet recording advice, instruction or decision on the matter in the file","The agenda","A press statement"],1,"Minutes on files create an audit trail of how a matter was handled.");
  m(H,"When an officer writes 'Pl. see' and passes a file to a superior, the officer is:",["Rejecting the file","Inviting the superior to read and take note or decide","Closing the file","Requesting leave"],1,"'Please see' draws attention to the matter for consideration.");
  m(M,"The function of HR that ensures records of each officer (appointment, promotion, discipline) are complete is:",["Personnel records management","Procurement","Budgeting","Revenue"],0,"Officers' personal files are the basis of every establishment decision.");
  s(M,"What single word describes the deliberate preparation of officers to take over key posts in future?",["succession","succession planning"],"Succession planning protects continuity when senior officers retire.");
  m(M,"Exit interviews with departing staff are mainly used to:",["Recover salary","Understand why staff leave and improve retention","Discipline them","Approve pensions"],1,"Patterns in exit feedback reveal management or welfare problems.");

  /* ---------------- Executive Officer (General Duties) ---------------- */
  cadre("Executive Officer (General Duties) Cadre");
  m(E,"The book in which all incoming letters are recorded on receipt is the:",["Dispatch book","Incoming mail register","Vote book","Visitors' book"],1,"It records date received, sender, subject and to whom the item was passed.");
  m(E,"The book used to record outgoing letters and obtain signatures of recipients is the:",["Dispatch book","Cash book","Attendance register","Log book"],0,"A signed dispatch book proves delivery.");
  m(M,"A register that shows where every file is at any time is the:",["File movement register","Stock ledger","Minute sheet","Nominal roll"],0,"Tracking file movement prevents files getting lost.");
  x(M,"Match each filing method to how files are arranged.",[["Alphabetical","By name, A to Z"],["Numerical","By assigned number"],["Subject","By topic or function"],["Chronological","By date"]],"The choice depends on how records are most often retrieved.");
  m(M,"On a minute sheet, 'N.F.A.' means:",["Note For Action","No Further Action","New File Attached","Not For Approval"],1,"The matter is concluded and the file can be put away.");
  m(M,"'P.A.' written on a file means:",["Put Away","Personal Assistant","Please Approve","Pending Action"],0,"The file is returned to the registry shelves.");
  m(M,"When a file becomes too thick, the registry should:",["Throw away old papers","Close it and open a new part (e.g. Vol. II) cross-referenced to the old one","Split it randomly","Give it to the officer to keep"],1,"Closed parts are kept with the new part referenced to them.");
  m(H,"Records that are no longer needed for current business but must be kept for legal or historical reasons should be:",["Burnt","Transferred to semi-current storage or archives under a retention schedule","Sold as waste paper","Kept on officers' desks"],1,"A retention and disposal schedule decides what is kept, archived or destroyed, and when.");
  m(M,"A cross-reference sheet in a file is used to:",["Record attendance","Point to related papers kept in another file","Record leave","List visitors"],1,"It avoids duplicate filing while keeping records linked.");
  t(E,"Confidential documents may be left on an open desk when the officer goes for lunch.",false,"Classified documents must be locked away when unattended.");
  t(M,"A file census is a periodic check that all registered files can be located.",true,"It exposes missing files and updates the file movement register.");
  t(M,"Each letter sent out should carry a reference number linking it to the file on which the matter is handled.",true,"References let replies be filed in the right place.");
  m(M,"The first thing a registry clerk should do on receiving incoming mail is to:",["Open private letters addressed to officers","Date-stamp and register the mail","Throw away envelopes immediately","Reply to it"],1,"Registration and date-stamping create the record of receipt.");
  m(H,"An incoming letter marked 'Personal and Confidential' addressed to a Director should be:",["Opened by the registry","Delivered unopened to the addressee and recorded","Read by the messenger","Filed without delivery"],1,"Only the addressee (or an authorised person) opens such mail.");
  o(M,"Arrange the steps for handling an incoming official letter.",["Receive and date-stamp","Register in the incoming mail register","Attach to the relevant file","Pass to the action officer","Reply and dispatch"],"This sequence ensures every letter is traceable from receipt to reply.");
  m(M,"A 'temporary file' (T-file) is opened when:",["The main file cannot be found or is in use, and the papers are later merged into it","A file is closed","A visitor arrives","An officer retires"],0,"T-files must be merged into the substantive file as soon as possible.");
  m(E,"Good customer service at a public front desk includes:",["Ignoring callers","Courtesy, clear information and prompt referral","Collecting tips","Shouting instructions"],1,"The front desk is often the public's first impression of a Ministry.");
  m(M,"'F.Y.I.' on a minute means:",["File Your Instructions","For Your Information","Find Your Item","Final Year Index"],1,"No action is required beyond noting the content.");
  s(E,"What is the name of the sheet attached to a file on which officers write their comments and instructions?",["minute sheet","minute paper","minutes sheet"],"The minute sheet records the flow of advice and decisions.");
  m(M,"The best way to protect electronic records from loss is to:",["Keep one copy on a single PC","Back them up regularly to secure, separate storage","Print everything","Email them to personal accounts"],1,"Regular, secure backups protect against disk failure and ransomware.");

  /* ---------------- Executive Officer (Accounts) ---------------- */
  cadre("Executive Officer (Accounts) Cadre");
  m(E,"The document that authorises a payment and shows the payee, amount and vote charged is the:",["Receipt","Payment voucher","Invoice","Bin card"],1,"No payment should be made without a properly certified payment voucher.");
  m(M,"In double-entry bookkeeping, every transaction is recorded:",["Once","As a debit in one account and an equal credit in another","Only in the cash book","Only at year end"],1,"Equal debits and credits keep the books in balance.");
  m(M,"The accounting equation is:",["Assets = Liabilities + Equity","Assets = Income − Expenses","Liabilities = Assets + Equity","Cash = Profit"],0,"In public-sector terms, assets = liabilities + net assets.");
  m(M,"A trial balance is prepared to:",["Pay salaries","Check that total debits equal total credits in the ledger","Approve budgets","Record visitors"],1,"Agreement does not prove there are no errors (e.g. errors of omission), but disagreement proves there are some.");
  m(H,"A bank reconciliation statement explains the difference between:",["Two bank accounts","The cash book balance and the bank statement balance","Budget and actual","Revenue and expenditure"],1,"Differences arise from unpresented cheques, uncredited lodgements, bank charges and errors.");
  m(H,"A cheque issued and entered in the cash book but not yet paid by the bank is called:",["An uncredited lodgement","An unpresented cheque","A dishonoured cheque","A stale cheque"],1,"It reduces the cash book balance but not yet the bank balance.");
  m(M,"Money received by government must be acknowledged by issuing:",["A payment voucher","An official receipt (e.g. Treasury Receipt)","An LPO","A memo"],1,"Official receipts are serially numbered and accountable documents.");
  m(M,"Under the imprest system of petty cash, at the end of each period the petty cashier:",["Keeps the balance","Is reimbursed exactly the amount spent, restoring the fixed float","Pays the balance to staff","Closes the account"],1,"The float always returns to the agreed fixed amount.");
  m(M,"A 'contra' entry in a cash book records:",["Bank charges","A transfer between the cash and bank columns","Salary payments","Revenue only"],1,"Cash paid into the bank (or withdrawn) is recorded on both sides.");
  m(H,"An advance granted to an officer for an official journey must be:",["Kept as a gift","Retired with receipts and any unspent balance refunded","Repaid only at retirement","Written off"],1,"Unretired advances are recovered from salary and attract audit queries.");
  t(E,"Payment vouchers should be checked, certified and approved by different officers.",true,"Segregation of duties is a basic internal control.");
  t(M,"Cash received for revenue may be used directly to pay office expenses before it is banked.",false,"Revenue must be paid in intact; expenditure is made only from appropriated funds.");
  t(M,"A ledger is a book containing individual accounts to which entries from books of original entry are posted.",true,"Cash book and journal entries are posted to ledger accounts.");
  x(M,"Match each book or document to its purpose.",[["Cash book","Records receipts and payments of cash and bank"],["Journal","Records entries not in other books, e.g. corrections"],["Ledger","Holds individual accounts"],["Vote book","Controls spending against each vote"]],"Each record has a distinct role in public accounts.");
  m(M,"Deductions commonly made from salaries include:",["PAYE tax, pension contribution and approved loans","Fuel and generator costs","Contractor fees","Electricity bills of the office"],0,"Statutory deductions must be remitted promptly to the right agencies.");
  m(M,"Which error would NOT be revealed by a trial balance?",["A one-sided entry","A transaction completely omitted from the books","Adding a column wrongly","Posting a debit as a credit"],1,"Errors of omission keep debits and credits equal, so the trial balance still agrees.");
  s(M,"A petty cash float is ₦50,000. Expenses of ₦36,500 were paid. How much is reimbursed to restore the imprest? (figures only)",["36500","₦36,500","36,500"],"Under the imprest system you reimburse the amount spent (₦36,500), restoring the ₦50,000 float. ₦13,500 is the cash still on hand.");
  o(M,"Arrange the steps in processing a payment.",["Raise the payment voucher with supporting documents","Check and certify","Approve by the authorised officer","Pre-payment audit","Make payment and record it"],"Each step adds a control before money leaves the treasury.");
  m(E,"A dishonoured cheque is one that:",["Has been paid","The bank has refused to pay, e.g. for insufficient funds","Is not yet presented","Is crossed"],1,"The amount must be reversed in the cash book.");
  m(H,"Straight-line depreciation charges:",["A rising amount each year","The same amount each year over the asset's useful life","Nothing","Only in the first year"],1,"(Cost − residual value) ÷ useful life.");

  /* ---------------- Executive Officer (Audit) ---------------- */
  cadre("Executive Officer (Audit) Cadre");
  m(M,"'Vouching' in auditing means:",["Approving payments","Checking entries in the records against supporting documents","Preparing budgets","Counting cash only"],1,"Vouching tests whether recorded transactions are genuine and supported.");
  m(M,"'Verification' in auditing refers mainly to confirming:",["Staff attendance","The existence, ownership and value of assets","Budget approval","Revenue targets"],1,"For example, physically inspecting vehicles listed in the asset register.");
  m(M,"An audit query is:",["A promotion letter","A written request to an officer to explain an irregularity found during audit","A budget call","A training form"],1,"Queries must be answered within the stated period with supporting evidence.");
  m(H,"A pre-payment audit is carried out:",["After payment","Before payment, to confirm the voucher is valid, approved and correctly charged","At year end only","By the contractor"],1,"It prevents irregular payments rather than detecting them later.");
  m(M,"An 'audit trail' is:",["A path in the garden","The documented sequence that allows a transaction to be traced from source to final records","A list of auditors","An audit fee"],1,"A clear audit trail is essential for accountability.");
  m(H,"Testing a sample of transactions rather than all of them is justified because:",["It is always more accurate","Properly selected samples give reasonable assurance at acceptable cost","Auditors are lazy","The law forbids full testing"],1,"Sampling balances assurance against time and cost.");
  m(M,"Segregation of duties as an internal control means:",["One officer handles a transaction from start to finish","Different officers authorise, record and handle assets for the same transaction","Officers rotate desks daily","Everyone approves everything"],1,"It reduces the risk of error and fraud.");
  x(M,"Match each audit term to its meaning.",[["Materiality","Size or nature of an error that would influence decisions"],["Audit evidence","Information used to support audit findings"],["Working papers","Records of audit work done and conclusions"],["Management letter","Report of control weaknesses and recommendations"]],"These are core concepts of audit practice.");
  m(M,"Which is a common red flag for fraud in payments?",["Payments to suppliers with complete documents","Repeated payments just below approval thresholds to the same supplier","Timely bank reconciliations","Rotation of duties"],1,"Splitting payments to avoid thresholds is a classic warning sign.");
  m(M,"A stores audit typically includes:",["Interviewing contractors only","Physical count of stock and comparison with bin cards and stock ledger","Approving the budget","Recruiting staff"],1,"Differences must be investigated and explained.");
  t(E,"Internal auditors should report directly to the Accounting Officer to protect their independence.",true,"Independence lets internal audit report without fear or favour.");
  t(M,"A clean trial balance proves that the accounts are free from all errors.",false,"Errors of omission, commission and principle can still exist.");
  t(M,"Audit working papers should be detailed enough for another auditor to understand the work done.",true,"Good working papers support conclusions and quality review.");
  m(H,"Compliance tests check that controls operate; substantive tests check:",["Staff morale","The accuracy and validity of the figures themselves","Office layout","Weather"],1,"Both kinds of test are combined to form an audit opinion.");
  m(M,"When an auditor finds that a payment voucher has no supporting invoice, the right step is to:",["Ignore it","Raise a query and request the missing documents","Pay the supplier again","Destroy the voucher"],1,"Unsupported payments are irregular until properly documented.");
  o(M,"Arrange the stages of an audit assignment in order.",["Planning","Fieldwork / testing","Evaluation of findings","Reporting","Follow-up of recommendations"],"Follow-up ensures recommendations are actually implemented.");
  m(M,"A surprise cash count is mainly intended to:",["Inform staff in advance","Confirm that cash on hand agrees with the records at an unannounced time","Pay salaries","Train cashiers"],1,"Surprise counts deter teeming and lading or borrowing from cash.");
  s(M,"Name the fraud in which receipts from one customer are used to cover a shortage from an earlier customer (three words, e.g. '_____ and _____').",["teeming and lading","teeming & lading"],"Teeming and lading delays detection of misappropriated receipts.");
  m(M,"Which body examines the Auditor-General's report on behalf of the State House of Assembly?",["Public Accounts Committee","Tenders Board","Civil Service Commission","Security Council"],0,"The PAC questions Accounting Officers on audit findings.");
  m(H,"A 'qualified' audit opinion means:",["The accounts are perfect","The auditor has reservations about specific matters in the accounts","The auditor is qualified","The audit was cancelled"],1,"A qualified opinion highlights material issues while accepting the rest.");

  /* ---------------- Executive Officer (Information) ---------------- */
  cadre("Executive Officer (Information) Cadre");
  m(M,"News writing usually follows the 'inverted pyramid', which means:",["The least important facts come first","The most important facts come first, followed by supporting details","The story ends with the main point","Only pictures are used"],1,"Readers and editors can cut from the bottom without losing the core news.");
  m(E,"The opening paragraph of a news story that summarises the key facts is the:",["Byline","Lead (intro)","Caption","Masthead"],1,"A good lead answers who, what, when, where, why and how.");
  m(M,"A press release marked 'Embargoed until 10:00, 14 May' means:",["It can never be published","It must not be published before that time","It is secret","It is cancelled"],1,"Embargoes let media prepare while respecting a release time.");
  m(M,"Which body regulates broadcasting in Nigeria?",["Nigerian Press Council","National Broadcasting Commission (NBC)","NCC only","NITDA"],1,"The NBC licenses and regulates radio and television stations.");
  m(M,"Publishing a false statement that damages a person's reputation is:",["Libel (defamation in permanent form)","Slander","Satire","Embargo"],0,"Libel is defamation in permanent form; slander is spoken.");
  x(M,"Match each term to its meaning.",[["Byline","Name of the writer of a story"],["Caption","Text explaining a photograph"],["Dateline","Place and date at the start of a story"],["Headline","Title of a story"]],"Basic newsroom vocabulary.");
  m(M,"Media monitoring in a Ministry's information unit means:",["Buying newspapers for staff","Tracking coverage of the Ministry in the media and reporting issues to management","Censoring journalists","Printing posters"],1,"It informs responses, corrections and strategy.");
  m(H,"During a crisis, the government communicator should FIRST:",["Stay silent until everything is known","Issue a prompt, accurate holding statement and commit to updates","Blame the media","Delete social media accounts"],1,"Early, honest communication limits rumours.");
  m(M,"Information given to a journalist 'off the record' means:",["It can be quoted with the source's name","It should not be published or attributed","It is false","It is for broadcast only"],1,"Terms should be agreed before the information is shared.");
  m(E,"'News values' are criteria that make an event newsworthy. Which is one?",["Timeliness","Font size","Paper quality","Office location"],0,"Others include proximity, prominence, impact, conflict and human interest.");
  t(E,"A press release should include contact details for further information.",true,"Journalists need someone to verify facts or request interviews.");
  t(M,"Photographs used in official publications do not need captions.",false,"Captions identify people and context and prevent misinterpretation.");
  t(M,"Public enlightenment campaigns aim to inform citizens about government programmes and change behaviour where needed.",true,"Examples include sanitation, health and traffic campaigns.");
  o(M,"Arrange the steps in organising a press conference.",["Define the purpose and key messages","Invite the media and prepare the venue","Brief the spokesperson","Hold the conference and take questions","Distribute the press release and follow up"],"Preparation ensures a clear, controlled message.");
  m(M,"A feature article differs from a straight news story mainly because it:",["Must be short","Explores a topic in depth with background, colour and human interest","Has no facts","Is always about sports"],1,"Features are less time-bound than hard news.");
  m(M,"Which practice is MOST important when managing a Ministry's social media account?",["Posting unverified rumours quickly","Posting accurate, approved information and responding courteously","Arguing with critics","Sharing personal opinions"],1,"Official accounts speak for the government.");
  s(E,"What is the name of the person who checks and corrects copy before publication?",["editor","sub-editor","subeditor","copy editor","copyeditor"],"Editors check accuracy, clarity, style and length.");
  m(H,"Which body handles complaints about the conduct of print journalists in Nigeria?",["Nigerian Press Council","NBC","CAC","NUJ Election Committee"],0,"The Nigerian Press Council promotes professional standards in the print media.");
  m(M,"The '5Ws and H' of news writing are:",["Who, What, When, Where, Why and How","Write, Wait, Watch, Warn, Win, Help","Who, Whom, Whose, Which, Why, Here","None"],0,"A complete story answers all six.");
  m(M,"A 'rejoinder' is:",["A press release launching a project","A response correcting or clarifying a published report","A photograph","An advertisement"],1,"Rejoinders should be factual and temperate.");

  /* ---------------- Clerical ---------------- */
  cadre("Clerical Cadre");
  m(E,"When filing alphabetically, which name comes first?",["Adebola","Adebayo","Adebowale","Adebiyi"],1,"Compare letter by letter: all start A-D-E-B, then 'a' (Adebayo) comes before 'i', 'o' — so Adebayo is first.");
  m(E,"Under the 'nothing before something' rule, which is filed first?",["Bank Lagos","Banks Lagos","Bankole","They are equal"],0,"'Bank' (shorter, nothing after) files before 'Banks' and 'Bankole'.");
  m(E,"The proper way to answer an official telephone call is to:",["Say 'Who is this?'","Greet the caller, give your office or name, and offer help","Remain silent","Put the caller on hold immediately"],1,"Courteous, identified answering is basic office etiquette.");
  m(M,"When taking a telephone message for an absent officer, you should record:",["Only the caller's name","Caller's name, number, date, time, message and your name","Nothing","Only the time"],1,"Complete messages allow prompt follow-up.");
  m(E,"Stationery for the office is usually obtained from the store by completing a:",["Payment voucher","Requisition form / store issue voucher","Leave form","Visitors' book"],1,"Requisitions create an accountable record of issues.");
  m(M,"A visitor arrives without an appointment to see the Director. The clerk should:",["Send them straight in","Politely take details and check with the Director's office whether they can be seen","Ask them to leave rudely","Collect money"],1,"Courtesy combined with proper screening protects the officer's time.");
  m(M,"A 'cross-reference' in a filing system is used when:",["A document relates to more than one file","A file is lost","A file is closed","Typing errors occur"],0,"It tells users where the related document is kept.");
  t(E,"Official documents should be kept confidential and not discussed with unauthorised persons.",true,"Confidentiality is part of the Official Secrets obligations of public officers.");
  t(E,"It is acceptable to remove papers from an official file to save space.",false,"Papers must never be removed; this breaks the record and audit trail.");
  t(M,"The date stamp on incoming mail shows when the mail was received by the office.",true,"It establishes timelines for responses.");
  m(E,"Which item is a piece of office equipment used to make copies of documents?",["Photocopier","Stapler only","Perforator","Franking machine"],0,"Photocopiers reproduce documents; franking machines print postage.");
  m(M,"Before photocopying confidential documents, the clerk should:",["Make extra copies for friends","Obtain authorisation and control the number of copies","Leave originals in the machine","Copy and post them on the notice board"],1,"Uncontrolled copies are a common source of leaks.");
  o(E,"Arrange these names in correct alphabetical filing order.",["Abiola","Adams","Adeyemi","Afolabi","Agbaje"],"A-B, A-D-A, A-D-E, A-F, A-G.");
  x(E,"Match each office item to its use.",[["Perforator","Punches holes in paper for filing"],["Stapler","Fastens papers together"],["Date stamp","Marks the date of receipt"],["Shredder","Destroys documents securely"]],"Common office equipment.");
  m(M,"Which date format is least likely to be misunderstood in official records?",["03/04/25","3 April 2025","3-4","04.03"],1,"Writing the month in words avoids day/month confusion.");
  m(M,"A form returned with missing information should be:",["Filed anyway","Returned to the sender with the missing items clearly indicated","Thrown away","Completed by guessing"],1,"Accurate records require complete information from the source.");
  s(E,"What is the name of the book in which visitors to an office sign in? (two words)",["visitors book","visitors' book","visitor's book","visitor book","visitors register"],"It records who entered, when and whom they saw.");
  m(M,"The main reason for keeping a file movement register is to:",["Count staff","Know where each file is at any time","Record salaries","Track visitors"],1,"It prevents loss and delay of files.");
  m(E,"Good punctuality and attendance by clerical staff mainly ensures:",["More overtime","Smooth office operations and service to the public","Fewer files","Less work for supervisors"],1,"Clerical staff keep the office running.");
  m(M,"When you notice an error in a document you typed and it has already been signed, you should:",["Ignore it","Inform the officer and correct it properly through the right channel","Change it secretly","Destroy the document"],1,"Signed documents must not be altered without authority.");

  /* ---------------- Assistant Secretarial Officer ---------------- */
  cadre("Assistant Secretarial Officer Cadre");
  x(E,"Match each salutation to the correct complimentary close (British usage).",[["Dear Sir","Yours faithfully"],["Dear Mrs Bello","Yours sincerely"],["Dear Madam","Yours faithfully"],["Dear Tunde","Best wishes / Yours sincerely"]],"Unnamed salutation → 'faithfully'; named → 'sincerely'.");
  m(M,"In a 'fully blocked' letter layout:",["Paragraphs are indented","Every line starts at the left margin","The date is centred","The address is on the right"],1,"Fully blocked style is the most common modern business layout.");
  m(M,"'Open punctuation' in a letter means:",["No punctuation at all in the body","No punctuation in the address, date, salutation and close, only in the body text","Many exclamation marks","Commas after every line"],1,"It is usually used with the fully blocked layout.");
  m(E,"'Encl.' at the foot of a letter indicates that:",["The letter is confidential","Something is enclosed with the letter","A copy was sent","The writer is absent"],1,"It reminds the recipient to look for enclosures.");
  m(M,"'Bcc' on an email means:",["Blind carbon copy — recipients are hidden from other recipients","Basic copy","Business contact card","Broadcast"],0,"Use Bcc to protect recipients' addresses.");
  m(M,"A typist types 1,800 words in 30 minutes. What is the speed in words per minute?",["45 wpm","60 wpm","90 wpm","30 wpm"],1,"1,800 ÷ 30 = 60 wpm.");
  m(M,"Mail merge is used to:",["Combine a standard letter with a list of names and addresses to produce personalised letters","Delete emails","Scan documents","Encrypt files"],0,"It saves time on bulk correspondence.");
  m(E,"Which keyboard row is the 'home row' for touch typing?",["The row with Q W E R T Y","The row with A S D F G H J K L","The number row","The space bar row"],1,"Fingers rest on the home row keys (ASDF / JKL;).");
  m(M,"The proofreading mark '¶' means:",["Delete","New paragraph","Insert space","Capitalise"],1,"¶ indicates a new paragraph should start.");
  m(M,"A '#' sign in proofreading margins usually means:",["Insert a space","Delete","Italicise","Move left"],0,"Proofreaders use # to request a space.");
  t(E,"An official letter should carry a reference, the date and the inside address of the recipient.",true,"These elements make letters traceable and properly addressed.");
  t(M,"Pitman shorthand is a phonetic system that records sounds rather than spelling.",true,"Pitman uses strokes based on sounds.");
  t(M,"'Yours faithfully' should be used when the recipient is addressed by name.",false,"Use 'Yours sincerely' when you address the person by name.");
  o(M,"Arrange the parts of a formal letter from top to bottom (fully blocked style).",["Reference","Date","Inside address","Salutation","Subject heading","Body","Complimentary close","Signature and name"],"This is the standard sequence of a fully blocked letter.");
  m(M,"Before printing a long official document, the assistant should first:",["Print several copies","Proofread and use spell-check, then print a draft for checking","Send it to the press","Change the font randomly"],1,"Proofreading avoids reprints and embarrassment.");
  m(M,"Which Word feature keeps headings and page numbers consistent across a long report?",["Styles and headers/footers","Clip art","Word art","Text boxes only"],0,"Styles also let you generate a table of contents.");
  s(E,"What does 'cc' stand for at the foot of a letter? (two words)",["carbon copy","courtesy copy","carbon copies"],"It lists other people receiving a copy.");
  m(E,"Diary management for an officer involves:",["Writing personal stories","Recording and coordinating appointments and reminders","Paying bills","Cleaning"],1,"A well-kept diary prevents clashes and missed meetings.");
  m(M,"When a document is marked 'Confidential', the typist should:",["Leave drafts on the desk","Protect drafts and copies, and delete or shred spoiled pages","Share it with colleagues","Post it on social media"],1,"Confidential handling covers drafts and spoiled copies too.");
  m(M,"The keyboard shortcut Ctrl + B in most word processors:",["Prints","Applies bold formatting","Saves","Opens a file"],1,"Ctrl+I = italic; Ctrl+U = underline.");

  /* ---------------- Secretarial Officer (Confidential Secretary) ---------------- */
  cadre("Secretarial Officer Cadre (Confidential Secretary)");
  m(M,"The confidential secretary's role as 'gatekeeper' to a senior officer means:",["Locking the office permanently","Screening calls, visitors and mail so the officer's time goes to priorities","Refusing all visitors","Answering for the officer on policy"],1,"Gatekeeping must be courteous, fair and in line with the officer's instructions.");
  m(M,"Verbatim minutes record:",["Only decisions","Every word spoken","A summary","Only attendance"],1,"Verbatim records are used in courts and legislatures; most meetings use summary or action minutes.");
  m(M,"'Action minutes' focus on:",["Who said what","Decisions taken, who will act and by when","The menu","Attendance only"],1,"They make follow-up easy.");
  m(H,"A 'notice of meeting' should be sent:",["After the meeting","In advance, stating date, time, venue and agenda, within the period required by the rules","Only to the chairman","By word of mouth only"],1,"Adequate notice is required for valid meetings.");
  m(M,"When arranging official travel for a principal, the secretary should prepare:",["Only the ticket","An itinerary showing travel details, accommodation, meetings and contacts","A press release","A budget call circular"],1,"A complete itinerary prevents confusion on the trip.");
  m(M,"A caller insists on knowing the Permanent Secretary's private schedule. The secretary should:",["Give it","Politely decline and offer to pass a message","Hang up","Post it online"],1,"Principals' schedules are confidential for security reasons.");
  m(M,"The best way to prioritise many tasks given by a principal is to:",["Do them in the order received","Clarify deadlines and importance, then plan using a to-do list or priority matrix","Do the easiest first always","Ignore some"],1,"Clarify, prioritise and communicate progress.");
  x(M,"Match each meeting role to its responsibility.",[["Chairman","Conducts the meeting and keeps order"],["Secretary","Prepares notices, agenda and minutes"],["Member","Participates and votes"],["Observer","Attends without voting rights"]],"Clear roles make meetings efficient.");
  t(E,"Drafts of confidential documents should be shredded when no longer needed.",true,"Spoiled drafts are a common source of leaks.");
  t(M,"A secretary may alter a letter after the principal has signed it, if the change is small.",false,"Signed documents must not be altered without the signatory's knowledge and authority.");
  t(M,"A pending tray system helps track documents awaiting action.",true,"In/out/pending trays organise the flow of work.");
  o(M,"Arrange the secretary's tasks for a board meeting in order.",["Agree date and agenda with the chairman","Send notice and agenda papers","Prepare the venue and attendance list","Take minutes during the meeting","Circulate draft minutes for approval"],"Preparation, recording and follow-up.");
  m(M,"Professional email etiquette includes:",["Using capital letters for emphasis throughout","A clear subject, polite greeting, concise message and signature","Sending large unnecessary attachments","Replying-all to everything"],1,"Capitals read as shouting.");
  m(H,"When transcribing a principal's dictation, the secretary should:",["Change the meaning to improve it","Transcribe faithfully, correct obvious grammar and query anything unclear","Leave gaps without asking","Add personal comments"],1,"Fidelity with sensible correction and verification.");
  m(M,"Which document summarises a long report for a busy executive?",["Appendix","Executive summary","Index","Bibliography"],1,"It states purpose, key findings and recommendations briefly.");
  m(E,"Protocol at official functions includes:",["Ignoring seating plans","Correct seating, order of recognition and proper titles for dignitaries","Wearing casual clothes","Seating by arrival"],1,"Protocol avoids embarrassment and shows respect.");
  s(M,"What is the term for the list of items to be discussed at a meeting?",["agenda","an agenda"],"Agenda papers are circulated in advance.");
  m(M,"An appointment diary clash occurs. The secretary should:",["Cancel both","Inform the principal promptly and propose alternatives","Choose one without telling anyone","Ignore it"],1,"The principal decides priorities; the secretary offers options.");
  m(M,"When the principal is away, urgent mail should be:",["Left unopened for weeks","Handled according to standing instructions, e.g. referred to the officer acting","Thrown away","Answered with the principal's signature forged"],1,"Standing instructions keep business moving lawfully.");
  m(M,"Electronic files with sensitive content are best protected by:",["Saving them on a shared public drive","Password protection and access controls, with regular backups","Emailing them to personal accounts","Leaving the PC unlocked"],1,"Lock the screen whenever leaving the desk.");

  /* ---------------- Storekeeper ---------------- */
  cadre("Storekeeper Cadre");
  m(E,"The card kept with each item in the store showing receipts, issues and balance is the:",["Bin card","Visitors' card","Payment voucher","Identity card"],0,"The bin card balance should always agree with the physical stock.");
  m(E,"When goods are received into the store, the storekeeper prepares a:",["Store Receipt Voucher (SRV)","Leave form","Payment voucher","Memo"],0,"The SRV records quantity and condition of goods received.");
  m(E,"Goods are issued from the store against a:",["Store Issue Voucher (SIV) / requisition","Verbal request","Text message","Newspaper advert"],0,"Issues must be supported by authorised documents.");
  m(M,"FIFO in stores management means:",["First In, First Out — older stock is issued first","Fast In, Fast Out","Final Inventory, Final Order","First Item For Officers"],0,"FIFO prevents stock expiring or deteriorating.");
  m(M,"Before signing for goods delivered by a supplier, the storekeeper should:",["Sign immediately","Check quantity, quality and specification against the LPO and delivery note","Ask for a gift","Store them unchecked"],1,"Defective or short deliveries must be noted before acceptance.");
  m(M,"Stock-taking means:",["Ordering new stock","Physically counting stock and comparing it with records","Issuing stock","Selling stock"],1,"Differences must be investigated and reported.");
  m(M,"Damaged or unserviceable store items should be:",["Thrown away by the storekeeper","Recorded and presented to a Board of Survey for decision on disposal","Taken home","Hidden"],1,"Only an authorised board can recommend write-off and disposal.");
  m(M,"Petrol, chemicals and gas cylinders in a store should be kept:",["Next to the office kitchen","In a separate, ventilated, secure area away from sources of ignition","On top of paper stock","Inside offices"],1,"Hazardous materials need separate, safe storage.");
  t(E,"The bin card balance should always agree with the actual quantity on the shelf.",true,"Any difference signals error or loss.");
  t(E,"A storekeeper may lend items from the store to friends if they return them.",false,"Store items are public property and may only be issued against authorised documents.");
  t(M,"Store keys should be controlled, and a register kept of who holds them.",true,"Key control is a basic security measure.");
  o(E,"Arrange the steps for receiving goods into the store.",["Check the delivery note against the LPO","Inspect quantity and quality","Accept and sign the delivery note","Prepare the Store Receipt Voucher","Update the bin card and stock ledger"],"Records are updated only after goods are verified.");
  x(E,"Match each store document to its use.",[["Bin card","Shows the running balance of one item at its location"],["Stock ledger","Accounting record of all store items"],["SRV","Records goods received"],["SIV","Records goods issued"]],"These documents provide an audit trail for stores.");
  m(M,"Perishable items such as food in a store should be:",["Stored anywhere","Stored in suitable conditions and issued by FIFO, checking expiry dates","Kept until they expire","Mixed with chemicals"],1,"Rotation and correct conditions reduce waste.");
  m(M,"The reorder level is the stock level at which:",["Stocktaking begins","A new order should be placed","Stock is thrown away","Stores close"],1,"Ordering at the reorder level avoids running out.");
  m(M,"The best way to arrange a store for quick retrieval is to:",["Pile everything together","Group items logically, label shelves and keep fast-moving items near the issue point","Store by colour","Hide valuable items under others"],1,"Good layout saves time and reduces errors.");
  s(E,"What is the name of the card kept on the shelf or bin showing each item's receipts, issues and balance? (two words)",["bin card","tally card"],"Also called a tally card in some stores.");
  m(M,"An item's bin card shows 120 units but only 100 are on the shelf. The storekeeper should:",["Change the card to 100 quietly","Report the shortage to the supervisor for investigation","Buy 20 privately","Ignore it"],1,"Discrepancies must be reported, not concealed.");
  m(E,"Fire safety in a store includes:",["Smoking in the store","Keeping extinguishers available and exits clear","Blocking exits with boxes","Storing petrol near heaters"],1,"Stores often hold large quantities of combustible material.");
  m(M,"A store's opening stock is 200 units, receipts are 150 and issues 230. What is the closing stock?",["120","150","170","580"],0,"200 + 150 − 230 = 120.");

  /* ---------------- Stores Officer ---------------- */
  cadre("Stores Officer Cadre");
  m(H,"The Economic Order Quantity (EOQ) formula is EOQ = √(2DS ÷ H). With annual demand D = 8,000 units, ordering cost S = ₦500 per order and holding cost H = ₦50 per unit per year, EOQ is:",["200 units","400 units","800 units","1,000 units"],1,"EOQ = √(2 × 8,000 × 500 ÷ 50) = √160,000 = 400 units.");
  m(H,"Daily usage of an item is 40 units and the supplier's lead time is 10 days, with a safety stock of 100 units. The reorder level is:",["400 units","500 units","140 units","1,000 units"],1,"Reorder level = (usage × lead time) + safety stock = 400 + 100 = 500.");
  m(M,"In ABC analysis, 'A' items are those that:",["Are the cheapest","Account for a large share of annual consumption value though few in number","Are obsolete","Are never used"],1,"A items deserve the tightest control.");
  m(M,"Safety (buffer) stock is held to:",["Increase holding costs deliberately","Protect against unexpected demand or delays in supply","Sell to staff","Replace stocktaking"],1,"It reduces the risk of stock-outs.");
  m(M,"Perpetual (continuous) stocktaking means:",["Counting all items once a year","Counting a few items regularly throughout the year so all are counted over a cycle","Never counting","Counting only expensive items"],1,"It spreads the workload and detects problems early.");
  m(M,"Stock turnover ratio measures:",["Staff turnover","How many times stock is used and replaced in a period","Store size","Supplier rating"],1,"Higher turnover generally means less capital tied up in stock.");
  m(M,"In a period of rising prices, FIFO valuation results in closing stock being valued at:",["The oldest prices","The most recent (higher) prices","Zero","Average prices only"],1,"Older, cheaper stock is issued first, so remaining stock carries recent prices.");
  m(M,"Obsolete stock is best handled by:",["Keeping it indefinitely","Identifying it promptly and recommending disposal through a Board of Survey","Hiding it","Issuing it to anyone"],1,"Obsolete stock occupies space and ties up value.");
  t(M,"Just-in-Time (JIT) aims to minimise stock holdings by receiving items close to when they are needed.",true,"JIT depends on reliable suppliers.");
  t(M,"Holding costs include storage space, insurance, deterioration and capital tied up in stock.",true,"These costs rise as stock levels rise.");
  t(H,"The EOQ is the order size at which ordering cost and holding cost are both zero.",false,"EOQ minimises the total of ordering and holding costs; at EOQ the two costs are equal.");
  x(M,"Match each inventory term to its meaning.",[["Lead time","Time between placing an order and receiving it"],["Reorder level","Stock level that triggers a new order"],["Maximum level","Upper limit to avoid overstocking"],["Minimum level","Lower limit below which stock should not fall"]],"These control levels guide replenishment.");
  o(M,"Arrange the stores replenishment cycle in order.",["Stock falls to the reorder level","Raise a purchase requisition","Procurement issues an order (LPO)","Goods are received and inspected","Stock records are updated"],"The cycle links stores control with procurement.");
  m(M,"VED analysis classifies items as Vital, Essential and Desirable based on:",["Price","Criticality to operations","Colour","Supplier"],1,"It is common for spare parts and medical stores.");
  m(H,"Which method of stock valuation is generally NOT accepted for financial reporting under IPSAS/IFRS?",["FIFO","Weighted average","LIFO","Specific identification"],2,"LIFO is not permitted under IAS 2 / IPSAS 12.");
  m(M,"Stock losses due to theft are best prevented by:",["Leaving the store open","Access control, segregation of duties, regular counts and CCTV","Trusting everyone","Removing records"],1,"Combining physical and procedural controls is most effective.");
  s(M,"Opening stock ₦2m, purchases ₦6m, closing stock ₦1m. What is the cost of stock consumed in ₦m? (number only)",["7"],"Consumption = opening + purchases − closing = 2 + 6 − 1 = 7.");
  m(M,"A warehouse management system mainly helps by:",["Replacing all staff","Tracking stock locations, movements and levels in real time","Paying suppliers","Recruiting storekeepers"],1,"Accurate data supports decisions and audits.");
  m(M,"The person who certifies that goods meet specifications on delivery should ideally be:",["The supplier","Independent of the person who ordered them, e.g. an inspection committee","The driver","Anyone available"],1,"Independent inspection reduces collusion risk.");
  m(H,"If annual demand is 12,000 units and the EOQ is 600 units, how many orders are placed per year?",["10","20","30","60"],1,"12,000 ÷ 600 = 20 orders.");

  /* ---------------- Library Officer ---------------- */
  cadre("Library Officer Cadre");
  x(M,"Match each Dewey Decimal main class to its subject.",[["000","Computer science, information & general works"],["300","Social sciences"],["500","Natural sciences & mathematics"],["900","History & geography"]],"The DDC divides knowledge into ten main classes.");
  m(E,"In the Dewey Decimal Classification, class 600 covers:",["Religion","Technology (applied sciences)","Literature","Languages"],1,"600 = technology, including medicine and engineering.");
  m(M,"The register in which every new book is recorded with a unique serial number on arrival is the:",["Accession register","Circulation register","Visitors' book","Shelf list only"],0,"Accession numbers identify each copy.");
  m(M,"The 'call number' on a book's spine is used to:",["Identify the publisher","Locate the book on the shelves","Show the price","Show the borrower"],1,"It combines the class number and author mark.");
  m(E,"ISBN stands for:",["International Standard Book Number","Internal Serial Book Note","Index of Standard Books in Nigeria","International Serial Binding Number"],0,"ISBNs uniquely identify book editions.");
  m(M,"Since 2007 an ISBN has how many digits?",["8","10","13","16"],2,"ISBN-13 replaced ISBN-10.");
  m(M,"Serials such as journals are identified by an:",["ISBN","ISSN","URL only","Accession date"],1,"ISSN (8 digits) identifies serial publications.");
  m(E,"Circulation services in a library deal with:",["Cataloguing only","Lending and returning materials","Building maintenance","Book binding"],1,"Circulation desks manage loans, renewals and reservations.");
  m(M,"Reference books such as dictionaries and encyclopaedias are usually:",["Lent for long periods","For use within the library only","Sold","Thrown away yearly"],1,"They must be available for everyone to consult.");
  m(M,"'Weeding' a library collection means:",["Removing outdated, damaged or unused items according to policy","Cleaning the garden","Adding new books","Repairing shelves"],0,"Weeding keeps the collection relevant and usable.");
  t(E,"An OPAC is an Online Public Access Catalogue that users search to find library materials.",true,"It replaced the card catalogue in most libraries.");
  t(M,"Books on the shelf are arranged from left to right and top to bottom in call-number order.",true,"Consistent shelving makes items easy to find.");
  t(E,"Library users should be charged no fines and allowed to keep books indefinitely.",false,"Loan periods and overdue procedures ensure fair access.");
  o(E,"Arrange these Dewey numbers in correct shelf order.",["320.9","330.1","331","500.2","510"],"Compare class numbers digit by digit, treating decimals as decimals.");
  m(M,"Which is the best way to repair a book with a loose page?",["Staple it","Use archival-quality tape or tipping-in with suitable adhesive","Glue with any adhesive","Remove the page"],1,"Proper materials avoid further damage.");
  m(M,"An overdue notice is sent when:",["A book is new","A borrower has kept an item beyond its due date","A book is lost","The library closes"],1,"Reminders encourage prompt return.");
  s(E,"What does the abbreviation 'DDC' stand for? (three words)",["dewey decimal classification"],"Melvil Dewey published it in 1876.");
  m(M,"Shelf reading means:",["Reading books on the shelf","Checking that items are in correct order on the shelves","Lending books","Buying shelves"],1,"Misplaced books are effectively lost.");
  m(M,"Which environment is best for preserving paper materials?",["Hot and humid","Cool, dry and away from direct sunlight","Wet basements","Near kitchens"],1,"Heat, humidity and light accelerate deterioration.");
  m(E,"A library user cannot find a book on the shelf that the catalogue shows as available. The officer should:",["Say it is lost","Check nearby shelves, returns trolley and records, and offer a reservation","Ignore the user","Buy another copy immediately"],1,"Good service includes active help.");

  /* ---------------- Librarian ---------------- */
  cadre("Librarian Cadre");
  m(M,"Ranganathan's first law of library science is:",["Books are for use","Every reader his or her book","Save the time of the reader","The library is a growing organism"],0,"The five laws: books are for use; every reader his book; every book its reader; save the time of the reader; the library is a growing organism.");
  o(H,"Arrange Ranganathan's five laws in their original order.",["Books are for use","Every reader his or her book","Every book its reader","Save the time of the reader","The library is a growing organism"],"Published in 1931.");
  m(M,"MARC is a standard for:",["Library building design","Machine-readable cataloguing records","Book binding","Staff appraisal"],1,"MARC lets catalogue records be exchanged between systems.");
  m(H,"RDA (Resource Description and Access) is the successor to:",["DDC","AACR2","LCSH","ISBD only"],1,"RDA replaced the Anglo-American Cataloguing Rules, 2nd edition.");
  m(M,"Library of Congress Classification uses:",["Only numbers","Letters for main classes combined with numbers","Colours","Author names only"],1,"E.g. Q for science, K for law.");
  m(M,"LCSH stands for:",["Library Classification of Standard Headings","Library of Congress Subject Headings","Local Catalogue Search Help","Legal Code of Serial Holdings"],1,"It provides controlled subject vocabulary.");
  m(M,"In Nigeria, the law requiring publishers to deposit copies of their publications is administered by the:",["National Library of Nigeria (legal deposit)","NUC","NERDC","NBC"],0,"Legal deposit builds the national bibliographic record.");
  m(M,"An institutional repository is:",["A store room","A digital archive of an institution's intellectual output, often open access","A reading room","A cafeteria"],1,"It preserves and disseminates research and records.");
  m(M,"A Boolean search 'education AND Lagos' returns records that contain:",["Either word","Both words","Neither word","Only 'education'"],1,"AND narrows; OR broadens; NOT excludes.");
  m(M,"Collection development policy mainly guides:",["Staff leave","Selection, acquisition and weeding of library materials","Building repairs","Salary scales"],1,"It aligns the collection with users' needs and budget.");
  m(H,"Bibliometrics is the:",["Binding of books","Quantitative analysis of publications and citations","Repair of manuscripts","Design of shelves"],1,"Used to assess research impact.");
  t(M,"Koha is an example of an open-source integrated library management system.",true,"It handles cataloguing, circulation and OPAC.");
  t(M,"Information literacy is the ability to find, evaluate and use information effectively and ethically.",true,"Librarians teach it to users.");
  t(H,"Open access means that every publication can be reused without any licence conditions.",false,"Open access removes price barriers; reuse is governed by licences such as Creative Commons.");
  x(M,"Match each tool to its purpose.",[["Thesaurus","Controlled vocabulary with related terms"],["Union catalogue","Combined catalogue of several libraries"],["Abstract","Summary of a document's content"],["Index","Guide to where topics appear"]],"Information retrieval tools.");
  m(M,"Digitisation of rare documents mainly helps to:",["Destroy originals","Preserve originals by reducing handling and widening access","Increase fines","Replace cataloguing"],1,"Originals should still be preserved properly.");
  m(M,"A library's reference interview is used to:",["Recruit staff","Clarify a user's real information need","Check fines","Discipline staff"],1,"Users' first questions are often broader or narrower than their real need.");
  s(M,"What single word describes the removal of out-of-date or damaged items from a collection?",["weeding","deselection"],"Weeding keeps collections current and usable.");
  m(H,"Which metadata standard is widely used for describing digital resources in repositories?",["Dublin Core","DDC","LCC","ISBN"],0,"Dublin Core has 15 core elements such as title, creator and date.");
  m(M,"The main purpose of library performance statistics (loans, visits, enquiries) is to:",["Punish staff","Plan services and justify resources","Fill shelves","Replace budgets"],1,"Data supports management decisions.");

  /* ---------------- Teacher / Headmaster ---------------- */
  cadre("Teacher / Headmaster Cadre");
  o(M,"Arrange the levels of Bloom's (revised) taxonomy from lowest to highest.",["Remember","Understand","Apply","Analyse","Evaluate","Create"],"Lessons should move learners beyond recall to higher-order thinking.");
  m(E,"A scheme of work is:",["A daily lesson plan","A plan of topics to be taught over a term or year","A school timetable","A report card"],1,"Lesson plans break the scheme of work into individual lessons.");
  m(M,"Which is a key component of a lesson plan?",["Behavioural (learning) objectives","Teacher's salary","School fees","Parents' names"],0,"Objectives state what pupils will be able to do by the end of the lesson.");
  m(M,"Under the Universal Basic Education Act 2004, basic education in Nigeria covers:",["6 years of primary only","9 years: 6 years primary + 3 years junior secondary","12 years","3 years of nursery"],1,"UBE is free and compulsory for these 9 years.");
  m(M,"The body that manages basic education in Lagos State is:",["WAEC","Lagos State Universal Basic Education Board (LASUBEB)","NUC","JAMB"],1,"Each state has a SUBEB; UBEC coordinates at federal level.");
  m(M,"Continuous assessment means:",["One final examination only","Systematic assessment of learners throughout the term using tests, assignments and projects","Assessing teachers","Promoting all pupils automatically"],1,"It gives a fuller picture of learning.");
  m(M,"Formative assessment is mainly used to:",["Rank pupils at the end of the year","Give feedback during learning to improve teaching and learning","Certify graduates","Punish pupils"],1,"Summative assessment judges learning at the end.");
  m(M,"According to Piaget, children aged about 7–11 years are in the:",["Sensorimotor stage","Pre-operational stage","Concrete operational stage","Formal operational stage"],2,"They reason logically about concrete objects.");
  m(E,"Instructional materials help teaching mainly by:",["Making lessons longer","Making abstract ideas concrete and engaging learners' senses","Replacing the teacher","Increasing fees"],1,"Charts, models and real objects aid understanding.");
  x(E,"Match each school record to its purpose.",[["Attendance register","Daily record of pupils present"],["Admission register","Record of pupils enrolled"],["Log book","Record of important school events"],["Lesson notes","Teacher's plans for lessons"]],"Statutory records are inspected during supervision.");
  t(E,"Inclusive education means making provision for learners with disabilities and special needs within regular schools where possible.",true,"Inclusive practice adapts teaching to diverse learners.");
  t(M,"A headteacher's main role is purely administrative and has nothing to do with instruction.",false,"Headteachers are instructional leaders who supervise teaching and learning.");
  t(M,"Classroom rules are more effective when explained clearly and applied consistently.",true,"Consistency builds a positive learning environment.");
  m(M,"A pupil repeatedly disrupts lessons. The best FIRST step is to:",["Send the pupil home permanently","Talk with the pupil to find the cause, set clear expectations and involve parents if needed","Ignore it","Humiliate the pupil publicly"],1,"Understanding causes supports lasting behaviour change.");
  m(M,"Child-centred learning emphasises:",["The teacher talking all lesson","Learners' active participation, interests and discovery","Memorisation only","Corporal punishment"],1,"Pupils learn by doing and discussing.");
  m(H,"The national body that develops and reviews curricula for basic and secondary education in Nigeria is:",["NERDC","NUC","NABTEB","TRCN"],0,"The Nigerian Educational Research and Development Council.");
  m(M,"The Teachers Registration Council of Nigeria (TRCN) mainly:",["Pays teachers' salaries","Registers and regulates the teaching profession","Builds schools","Sets WAEC exams"],1,"Registration is required to practise as a teacher.");
  s(E,"What is the name of the register in which pupils' daily presence is recorded? (one word before 'register')",["attendance","attendance register"],"It is a statutory school record.");
  m(M,"Which questioning technique encourages higher-order thinking?",["Yes/no questions only","Open-ended 'why' and 'how' questions","No questions","Reading from the textbook"],1,"Open questions require explanation and reasoning.");
  m(M,"A School-Based Management Committee (SBMC) involves:",["Only teachers","Parents, community members and school staff in supporting school management","Only the Ministry","Students only"],1,"SBMCs strengthen community participation.");

  /* ---------------- Assistant Education Officer ---------------- */
  cadre("Assistant Education Officer Cadre");
  m(M,"The main purpose of school inspection / quality assurance visits is to:",["Find faults to punish teachers","Assess and improve the quality of teaching, learning and school management","Collect fees","Build classrooms"],1,"Modern quality assurance is developmental, not only fault-finding.");
  m(M,"Nigeria's National Policy on Education introduced the system popularly called:",["6-3-3-4","8-4-4","7-5-2-3","5-4-4"],0,"6 years primary, 3 JSS, 3 SSS, 4 tertiary (now with 9-year basic education).");
  m(M,"The Annual School Census (ASC) collects data on:",["Teachers' religion","Enrolment, teachers, facilities and other school statistics for planning","Parents' income only","Exam questions"],1,"It feeds the Education Management Information System.");
  m(M,"The Pupil–Teacher Ratio is calculated as:",["Teachers ÷ pupils","Pupils ÷ teachers","Classrooms ÷ pupils","Schools ÷ teachers"],1,"E.g. 1,200 pupils ÷ 30 teachers = 40:1.");
  m(M,"A school has 1,350 pupils and 30 teachers. Its pupil–teacher ratio is:",["40:1","45:1","30:1","50:1"],1,"1,350 ÷ 30 = 45.");
  m(M,"Curriculum implementation is mainly the responsibility of:",["Teachers in the classroom, supported by school leaders and supervisors","Publishers","Parents only","Examination bodies only"],0,"The curriculum comes alive through teaching.");
  m(H,"A School Development Plan should be based on:",["The headteacher's personal wishes","A self-evaluation of the school's strengths and needs, with priorities, actions and resources","Last year's plan copied","Political promises"],1,"Evidence-based planning improves outcomes.");
  t(E,"Teachers' lesson notes are among the records checked during school supervision.",true,"They show planning and coverage of the scheme of work.");
  t(M,"The examination body that conducts the Basic Education Certificate Examination (BECE) at state level is the State Ministry/Examination Board.",true,"BECE marks the end of junior secondary school.");
  t(M,"School supervision reports are confidential and should never be discussed with the school.",false,"Feedback to the school is essential for improvement.");
  x(M,"Match each body to its role.",[["UBEC","Coordinates Universal Basic Education nationally"],["WAEC","Conducts the West African Senior School Certificate Examination"],["NECO","Conducts the national senior school certificate examination"],["TRCN","Registers and regulates teachers"]],"Key national education agencies.");
  o(M,"Arrange the stages of a supervisory visit in order.",["Pre-visit planning and review of school data","Entry meeting with the head","Classroom observation and record checks","Feedback meeting","Written report and follow-up"],"A structured visit gives fair, useful feedback.");
  m(M,"During a classroom observation, the supervisor should focus mainly on:",["The teacher's clothing","Teaching methods, learner engagement and achievement of objectives","The colour of the walls","The number of windows"],1,"Observation should improve learning.");
  m(M,"An Education Management Information System (EMIS) is used to:",["Pay salaries","Collect, process and use education data for planning and decisions","Build schools","Select textbooks"],1,"Reliable data underpins planning.");
  m(M,"Which indicator measures the share of pupils who complete a level of education?",["Gross enrolment rate","Completion rate","Repetition rate","Dropout rate"],1,"Completion rates show the system's efficiency.");
  m(M,"Repetition and dropout rates are indicators of:",["Teacher salaries","Internal efficiency of the education system","School size","Parents' wealth"],1,"High rates waste resources and opportunities.");
  s(M,"What does 'SBMC' stand for in basic education? (four words)",["school based management committee","school-based management committee","school based management committees"],"SBMCs involve communities in school governance.");
  m(M,"Which is an appropriate response when a supervisor finds a teacher with weak lesson delivery?",["Public criticism","Constructive feedback, demonstration or coaching, and follow-up visits","Immediate dismissal","Ignoring it"],1,"Supervision should build capacity.");
  m(M,"Inclusive education practices include:",["Excluding pupils with disabilities","Adapting teaching, materials and environment for diverse learners","Separate exams for boys only","Removing support staff"],1,"Inclusion requires reasonable adjustments.");
  m(E,"Basic education in Nigeria is meant to be:",["Free and compulsory","Optional","Only for urban children","Only for boys"],0,"As provided by the UBE Act 2004.");

  /* ---------------- Education Officer ---------------- */
  cadre("Education Officer Cadre");
  m(H,"The Gross Enrolment Rate (GER) can exceed 100% because:",["Of counting errors only","It counts all pupils enrolled at a level, including over-age and under-age pupils, against the official-age population","Schools are overcrowded","Private schools are excluded"],1,"The Net Enrolment Rate counts only official-age pupils.");
  m(H,"There are 90,000 pupils in primary school, 80,000 of them of official primary age, and the official-age population is 100,000. The NER is:",["80%","90%","100%","88.9%"],0,"NER = 80,000 ÷ 100,000 = 80%. (GER = 90%.)");
  m(M,"Lagos State public schools are organised into how many Education Districts?",["3","5","6","20"],2,"Each of the six Education Districts is headed by a Tutor-General / Permanent Secretary.");
  m(M,"The UBEC matching grant requires states to:",["Pay nothing","Provide counterpart funds to access federal UBE funds","Close schools","Charge fees"],1,"States must contribute matching funds.");
  m(M,"Educational planning mainly involves:",["Writing exams","Projecting needs (enrolment, teachers, classrooms) and allocating resources to meet policy goals","Teaching classes","Building libraries only"],1,"Planning links policy, data and budgets.");
  m(M,"The cohort analysis method in education is used to:",["Pay teachers","Track a group of pupils through grades to measure progression, repetition and dropout","Design uniforms","Select textbooks"],1,"It reveals internal efficiency.");
  m(M,"Which examination marks the end of senior secondary education in Nigeria?",["BECE","WASSCE / SSCE","Common Entrance","UTME only"],1,"WAEC and NECO conduct SSCE.");
  m(M,"Quality assurance in education focuses on:",["Only inputs like buildings","Inputs, processes and learning outcomes against standards","Only examination results","Only staff numbers"],1,"A balanced view of quality.");
  t(M,"Education is on the Concurrent Legislative List, so both federal and state governments can legislate on it.",true,"Responsibilities are shared across tiers.");
  t(H,"A falling pupil–teacher ratio always means learning outcomes have improved.",false,"Ratios are inputs; outcomes depend on teacher quality, materials and more.");
  t(M,"TVET stands for Technical and Vocational Education and Training.",true,"TVET builds employable skills.");
  x(M,"Match each education indicator to what it shows.",[["Transition rate","Share of pupils moving to the next level"],["Survival rate","Share of a cohort reaching a given grade"],["Pupil–classroom ratio","Average class crowding"],["Gender parity index","Ratio of female to male enrolment"]],"Key planning indicators.");
  o(M,"Arrange the stages of the curriculum development process.",["Needs analysis","Formulation of objectives","Selection and organisation of content","Implementation","Evaluation"],"A systematic approach (e.g. Tyler's model).");
  m(M,"Education financing in a state is mainly drawn from:",["Only donor funds","State budget allocations, federal transfers (e.g. UBE funds) and other sources","Teachers' contributions","Exam fees only"],1,"Multiple sources fund education.");
  m(H,"A Gender Parity Index (GPI) of 0.85 in enrolment indicates:",["Parity","Disparity in favour of boys","Disparity in favour of girls","No data"],1,"GPI below 1 means fewer girls than boys enrolled relative to parity.");
  m(M,"Teacher professional development is best delivered through:",["One-off lectures only","Continuous, practical, school-based support linked to classroom needs","No training","Promotion exams only"],1,"Sustained, job-embedded training changes practice.");
  s(M,"What does 'EMIS' stand for? (four words)",["education management information system","educational management information system"],"EMIS provides data for planning.");
  m(M,"An education policy evaluation should primarily ask:",["How much publicity it received","Whether the policy achieved its intended outcomes and at what cost","Who drafted it","How many meetings were held"],1,"Evaluation is about results and value.");
  m(H,"Public–private partnership in education might include:",["Government ignoring private schools","Government contracting private providers to manage schools or provide services under agreed standards","Abolishing public schools","Charging fees in basic education"],1,"PPPs require strong regulation and monitoring.");
  m(M,"The National Policy on Education is produced by the:",["Federal Ministry of Education (with NERDC)","WAEC","JAMB","NUC only"],0,"It guides education at all levels.");

  /* ---------------- Catering Officer ---------------- */
  cadre("Catering Officer Cadre");
  m(M,"The 'temperature danger zone' in which bacteria multiply fastest is approximately:",["−18°C to 0°C","5°C to 63°C","70°C to 100°C","0°C to 5°C only"],1,"Keep cold food below 5°C and hot food above 63°C.");
  m(M,"HACCP stands for:",["Hazard Analysis and Critical Control Points","Health and Catering Control Plan","Hygiene And Cooking Care Policy","Hotel and Catering Certificate Programme"],0,"HACCP identifies and controls food-safety hazards at critical points.");
  x(M,"Match each colour-coded chopping board to its use.",[["Red","Raw meat"],["Blue","Raw fish"],["Yellow","Cooked meat"],["Green","Salad and fruit"]],"Colour coding prevents cross-contamination.");
  m(M,"Food cost percentage is calculated as:",["Selling price ÷ food cost","Food cost ÷ selling price × 100","Food cost − selling price","Labour cost ÷ sales"],1,"E.g. ₦600 food cost on a ₦2,000 meal = 30%.");
  m(M,"A dish costs ₦900 in ingredients and the target food cost is 30%. The selling price should be:",["₦2,700","₦3,000","₦1,170","₦2,000"],1,"900 ÷ 0.30 = ₦3,000.");
  m(M,"Portion control is important mainly because it:",["Reduces customer satisfaction","Controls costs and ensures consistency","Increases waste","Slows service"],1,"Standard portions keep costs and quality predictable.");
  m(M,"Cross-contamination occurs when:",["Food is cooked thoroughly","Bacteria transfer from raw food or dirty surfaces to ready-to-eat food","Food is refrigerated","Food is covered"],1,"Separate equipment and handwashing prevent it.");
  m(M,"The head of a professional kitchen brigade is the:",["Commis chef","Chef de partie","Chef de cuisine (executive chef)","Kitchen porter"],2,"The sous chef is second in command.");
  m(M,"A balanced diet includes appropriate amounts of:",["Only carbohydrates","Carbohydrates, proteins, fats, vitamins, minerals and water","Only proteins","Only fruits"],1,"Menus for institutions should be nutritionally balanced.");
  m(M,"Which agency regulates food and drugs in Nigeria?",["NAFDAC","NBC","NCC","SON only"],0,"NAFDAC registers and regulates processed food, drugs and cosmetics.");
  t(E,"Food handlers with diarrhoea or vomiting should be excluded from handling food until cleared.",true,"They can spread food-borne illness.");
  t(M,"Frozen meat may be safely thawed on the kitchen floor at room temperature overnight.",false,"Thaw in a refrigerator or under controlled conditions to avoid the danger zone.");
  t(M,"Salmonella is a bacterium commonly associated with food poisoning from poultry and eggs.",true,"Thorough cooking and hygiene control it.");
  o(M,"Arrange the steps in menu planning for an institution.",["Identify the customers and their nutritional needs","Consider budget and available equipment","Draft the menu with variety and balance","Cost the menu","Review, approve and publish"],"Planning balances nutrition, cost and practicality.");
  m(M,"Stock rotation in a kitchen store follows:",["LIFO","FIFO","Random issue","Alphabetical order"],1,"First in, first out reduces spoilage.");
  m(H,"A Critical Control Point in HACCP is:",["Any point in the kitchen","A step at which control can be applied to prevent, eliminate or reduce a hazard to an acceptable level","The manager's office","The serving counter only"],1,"E.g. cooking temperature for chicken.");
  s(M,"What is the recommended maximum temperature (°C) for a refrigerator storing chilled food? (number only)",["5","5°c","5 degrees"],"Chilled food should be kept at 5°C or below (often 1–4°C).");
  m(M,"Banquet service for 300 guests requires most of all:",["No planning","Detailed planning of menu, staffing, timing and equipment","Only one waiter","Cooking on the day without preparation"],1,"Large events depend on planning and coordination.");
  m(M,"The most effective way for kitchen staff to prevent spreading germs is:",["Wearing jewellery","Frequent, thorough handwashing","Tasting food with fingers","Wiping hands on aprons"],1,"Handwashing is the single most important hygiene practice.");
  m(E,"Leftover cooked rice should be:",["Left out overnight","Cooled quickly, refrigerated and used within a short time, then reheated thoroughly","Kept warm for days","Frozen and refrozen repeatedly"],1,"Rice can carry Bacillus cereus spores that grow if left warm.");

  /* ---------------- Catering Assistant ---------------- */
  cadre("Catering Assistant Cadre");
  m(E,"The most important personal hygiene practice for food handlers is:",["Wearing perfume","Washing hands frequently and properly","Long nails","Wearing jewellery"],1,"Hands spread most food-borne germs.");
  m(E,"Hands should be washed after:",["Using the toilet, handling raw meat and touching the face or hair","Only at the end of the day","Only when visibly dirty","Never"],0,"Wash before handling food and after any contamination risk.");
  m(E,"A freezer should keep food at about:",["5°C","0°C","−18°C or colder","10°C"],2,"−18°C stops bacterial growth.");
  m(M,"A pan of oil catches fire. The correct action is to:",["Pour water on it","Turn off the heat and smother it with a fire blanket or lid","Carry it outside","Fan it"],1,"Water on burning oil causes explosive flare-up.");
  m(E,"When setting a table, the fork is usually placed:",["On the right","On the left of the plate","Above the glass","On the chair"],1,"Knives and spoons go on the right.");
  m(M,"In formal table service, food is traditionally served from the:",["Right, cleared from the left","Left, cleared from the right","Front only","Back"],1,"Drinks are usually served from the right.");
  m(E,"Wet floor signs should be used when:",["The floor is dry","A floor is being mopped or is wet","Guests arrive","Food is served"],1,"They prevent slips and falls.");
  m(E,"Knives should be carried:",["Pointing at people","Pointing downwards, close to the side","In a pocket","Thrown to colleagues"],1,"Safe handling prevents injuries.");
  x(E,"Match each cooking method to its type.",[["Boiling","Moist heat"],["Steaming","Moist heat"],["Roasting","Dry heat"],["Frying","Cooking in fat or oil"]],"Methods affect texture, flavour and nutrition.");
  t(E,"Raw meat should be stored on the bottom shelf of the refrigerator, below ready-to-eat foods.",true,"This stops drips contaminating other food.");
  t(E,"It is safe to use the same cloth to wipe raw meat surfaces and serving tables.",false,"This spreads bacteria; use separate cloths.");
  t(M,"Some customers may have food allergies, such as to peanuts, so ingredient information should be available.",true,"Allergic reactions can be life-threatening.");
  o(E,"Arrange the steps of proper handwashing.",["Wet hands with clean water","Apply soap","Rub all surfaces for at least 20 seconds","Rinse thoroughly","Dry with a clean towel or air dryer"],"Correct technique removes germs effectively.");
  m(E,"Kitchen waste bins should be:",["Left open","Covered, emptied regularly and kept clean","Stored near food","Washed once a year"],1,"Open bins attract pests.");
  m(M,"Hot food being held for service should be kept above:",["30°C","45°C","63°C","20°C"],2,"Above 63°C bacteria cannot multiply.");
  m(E,"The best way to clean a kitchen surface is to:",["Wipe with a dry cloth","Remove debris, wash with detergent, rinse and sanitise","Use only water","Leave it"],1,"Cleaning and disinfecting are separate steps.");
  s(E,"What colour chopping board is commonly used for raw meat? (one word)",["red"],"Colour-coded boards prevent cross-contamination.");
  m(E,"Signs of pests in a kitchen include:",["Droppings and gnawed packaging","Clean shelves","Fresh smell","Tidy store"],0,"Report signs of pests immediately.");
  m(E,"Food that has passed its 'use by' date should be:",["Served quickly","Discarded","Frozen","Given to staff"],1,"'Use by' dates relate to safety.");
  m(M,"Hair should be covered in the kitchen because:",["It looks smart only","Loose hair can fall into food and carry bacteria","It is cold","It is a uniform rule without reason"],1,"Hair nets and caps protect food.");

  /* ---------------- Driver ---------------- */
  cadre("Driver Cadre");
  m(E,"Before a journey, a driver should check:",["Fuel, oil, water/coolant, tyres, lights and brakes","Only the radio","Only the horn","Nothing"],0,"Daily pre-trip checks prevent breakdowns and crashes.");
  m(E,"The red oil-can warning light on the dashboard indicates:",["Low fuel","Low engine oil pressure — stop safely and check","Open door","Seat belt"],1,"Driving on with low oil pressure can wreck the engine.");
  m(M,"If the engine temperature gauge rises to red, the driver should:",["Open the radiator cap immediately","Stop safely, switch off and allow the engine to cool before checking coolant","Drive faster","Pour cold water on the engine"],1,"Opening a hot radiator can cause scalding.");
  m(M,"Defensive driving means:",["Driving aggressively","Anticipating hazards and others' mistakes and driving to avoid collisions","Driving only at night","Never overtaking"],1,"Keep space, scan ahead and expect the unexpected.");
  m(M,"The 'two-second rule' helps drivers to:",["Start the engine","Keep a safe following distance","Park","Signal"],1,"Double it in wet conditions.");
  m(E,"An official vehicle log book is used to record:",["The driver's salary","Journeys, mileage, fuel and maintenance","Visitors","Leave"],1,"It supports accountability for vehicle use.");
  m(M,"Tyre pressure should be checked when the tyres are:",["Hot after a long journey","Cold","Flat","Wet"],1,"Hot tyres give higher, misleading readings.");
  m(M,"Driving while fatigued is dangerous because it:",["Improves alertness","Slows reaction times and can cause micro-sleeps","Saves fuel","Is legal"],1,"Take breaks on long journeys.");
  m(E,"At a junction with a STOP sign, the driver must:",["Slow down only","Stop completely, then proceed when safe","Hoot and go","Speed up"],1,"STOP means a full stop.");
  x(E,"Match each road sign shape to its meaning.",[["Triangle","Warning"],["Circle with red border","Prohibition"],["Blue circle","Mandatory instruction"],["Octagon","Stop"]],"Recognising shapes helps quick decisions.");
  t(E,"Seat belts should be worn by the driver and all passengers.",true,"Seat belts greatly reduce injuries.");
  t(E,"Using a hand-held phone while driving is safe if the call is short.",false,"Any phone use distracts the driver and is an offence.");
  t(M,"Regular servicing according to the manufacturer's schedule extends a vehicle's life.",true,"Preventive maintenance is cheaper than repairs.");
  o(M,"Arrange the steps a driver should take after a minor crash.",["Stop safely and switch on hazard lights","Check for injuries and call for help if needed","Place the warning triangle","Exchange details and take photos","Report to the transport officer / police as required"],"Safety first, then documentation and reporting.");
  m(M,"Which vehicle documents should be carried?",["Vehicle licence, roadworthiness certificate, insurance and driver's licence","Only the car key","Only the log book","No documents"],0,"Officers may ask for them at checkpoints.");
  m(M,"When the brakes feel spongy, the most likely cause is:",["Too much fuel","Air in the brake lines or low brake fluid","New tyres","Clean windscreen"],1,"Do not drive until the brakes are fixed.");
  s(E,"What is the minimum legal tread depth for car tyres commonly used as a standard (in mm)? (number only)",["1.6","1.6mm"],"Below 1.6 mm grip falls sharply.");
  m(M,"When driving in heavy rain, the driver should:",["Increase speed","Reduce speed, increase following distance and use headlights","Use hazard lights while moving fast","Brake sharply"],1,"Wet roads lengthen stopping distances.");
  m(E,"A driver transporting a senior officer should:",["Drive recklessly to save time","Drive safely, be punctual, maintain the vehicle and keep confidential what is discussed","Discuss the officer's affairs with others","Use the car for private business"],1,"Discretion and safety are core duties of official drivers.");
  m(M,"Driving under the influence of alcohol is dangerous mainly because alcohol:",["Improves judgement","Impairs judgement, coordination and reaction time","Has no effect","Keeps you awake"],1,"Never drink and drive.");

  /* ---------------- Messenger ---------------- */
  cadre("Messenger Cadre");
  m(E,"When delivering official letters, the messenger should:",["Leave them anywhere","Obtain the recipient's signature in the dispatch book","Read them","Give them to anyone"],1,"Signatures prove delivery.");
  m(E,"A sealed envelope marked 'Confidential' should be:",["Opened to check contents","Delivered unopened to the addressee or authorised person","Left at the gate","Given to a friend"],1,"Confidential mail must reach only the right person.");
  m(E,"Files being carried between offices should be:",["Read on the way","Carried directly, not left unattended, and handed over properly","Left on the stairs","Taken home"],1,"Lost files cause serious problems.");
  m(E,"Good punctuality for a messenger means:",["Arriving late daily","Arriving on time and delivering mail promptly","Leaving early","Delivering when convenient"],1,"Delays can hold up important decisions.");
  m(E,"When a visitor asks for directions to an office, the messenger should:",["Ignore them","Politely direct or escort them","Ask for money","Send them away"],1,"Courtesy reflects well on the Ministry.");
  m(M,"If the addressee is absent, a confidential letter should be:",["Given to any clerk","Returned to the dispatching office or handed to the officer authorised to receive it, and recorded","Slipped under the door","Kept in the messenger's bag overnight"],1,"Follow the office's procedure for absent addressees.");
  m(E,"The book used to record letters sent out and the signatures of receivers is the:",["Dispatch book","Cash book","Visitors' book","Log book"],0,"It proves delivery.");
  t(E,"A messenger may discuss the contents of official files with members of the public.",false,"Official information is confidential.");
  t(E,"Messengers should report any lost or damaged mail immediately to their supervisor.",true,"Prompt reporting limits harm.");
  t(E,"Wearing an identity card helps staff and visitors recognise official staff.",true,"It supports office security.");
  o(E,"Arrange the steps for delivering a letter within the office.",["Collect the letter and dispatch book from the registry","Go directly to the addressee's office","Hand over the letter","Obtain the receiver's signature and date","Return the dispatch book to the registry"],"Each step keeps the delivery traceable.");
  x(E,"Match each item to its use.",[["Dispatch book","Records delivery of letters"],["File cover","Holds and protects official papers"],["Envelope","Encloses letters for delivery"],["Identity card","Shows that you are a staff member"]],"Basic tools of the messenger's work.");
  m(E,"A messenger finds an unattended file in the corridor. The right action is to:",["Leave it there","Take it to the registry or supervisor","Read it","Throw it away"],1,"Protect official records.");
  m(E,"Which is good conduct for a messenger?",["Rudeness to visitors","Courtesy, honesty and reliability","Collecting tips for delivering letters","Gossiping about officers"],1,"Messengers represent the Ministry.");
  m(M,"Before leaving the office at the end of the day, a messenger should ensure that:",["Undelivered mail is left on the floor","All mail is delivered or returned safely to the registry","Files are taken home","Doors are left open"],1,"No official papers should be left unsecured.");
  m(E,"If a senior officer asks a messenger to deliver an urgent file, the messenger should:",["Take a break first","Deliver it promptly and confirm delivery","Wait until tomorrow","Ask someone else to do it without telling the officer"],1,"Urgent means priority.");
  s(E,"What should a messenger obtain from the receiver when delivering an official letter?",["signature","a signature","receiver's signature","the signature"],"The signature is proof of delivery.");
  m(E,"Photocopying documents for officers should be done:",["With extra copies for oneself","Only in the number requested, returning the originals","At home","Without returning originals"],1,"Uncontrolled copies may leak information.");
  m(E,"Official vehicles or motorcycles used by messengers should be used:",["For private errands","Only for official duties","By friends","At weekends for business"],1,"Public property is for official use only.");
  m(E,"Speaking to a superior officer, a messenger should be:",["Rude","Respectful and clear","Silent always","Loud"],1,"Respect is part of public-service conduct.");

  /* ---------------- Watchman ---------------- */
  cadre("Watchman Cadre");
  m(E,"The book in which visitors' names, times of arrival and departure and persons visited are recorded is the:",["Visitors' register","Cash book","Bin card","Payment voucher"],0,"It supports access control and investigations.");
  m(E,"An 'occurrence book' at a security post records:",["Salaries","All incidents and events during each shift","Recipes","Exam scores"],1,"Entries should be dated, timed and signed.");
  m(E,"If you see a suspicious unattended bag in the premises, you should:",["Open it","Not touch it, keep people away and report immediately to the supervisor / police","Kick it","Take it home"],1,"Suspicious items may be dangerous.");
  m(E,"On hearing the fire alarm, the watchman should:",["Ignore it","Help evacuate people to the assembly point and call the fire service (112/767)","Lock all exits","Go home"],1,"Life safety comes first.");
  m(M,"Handover between shifts should include:",["Nothing","Keys, occurrence book entries and any outstanding issues, signed by both","Only greetings","Only the time"],1,"A proper handover maintains security continuity.");
  m(E,"Security patrols should be done:",["At the same times every night","At irregular times and routes","Only once a week","Only when it rains"],1,"Predictable patrols can be exploited by criminals.");
  m(E,"Keys to offices should be:",["Left in doors","Kept securely and issued only to authorised persons, with a key register","Given to visitors","Copied freely"],1,"Key control prevents unauthorised entry.");
  m(M,"A vehicle leaving the premises with government property should be:",["Waved through","Checked for an authorised gate pass","Ignored","Delayed without reason"],1,"Gate passes prevent theft of property.");
  t(E,"A watchman should sleep on duty only if nothing is happening.",false,"Sleeping on duty is serious misconduct.");
  t(E,"Emergency numbers such as 112 and 767 should be displayed at the security post.",true,"Quick access saves time in emergencies.");
  t(M,"Being observant and recording vehicle numbers and descriptions of suspicious persons helps investigations.",true,"Accurate details are valuable to police.");
  o(E,"Arrange the steps for admitting a visitor.",["Greet the visitor politely","Ask for identification and purpose of visit","Confirm with the host office","Record details in the visitors' register","Issue a visitor's tag and direct the visitor"],"Access control steps.");
  x(E,"Match each security item to its use.",[["Occurrence book","Records incidents during the shift"],["Visitors' register","Records people entering"],["Key register","Records issue and return of keys"],["Torch","Light for night patrols"]],"Tools of the security post.");
  m(E,"If a fight breaks out at the gate, the watchman should:",["Join the fight","Stay calm, call for help or police, and avoid using excessive force","Lock himself away","Film it only"],1,"Personal safety and de-escalation matter.");
  m(M,"Burglars are deterred most by:",["Darkness","Good lighting, regular patrols and secure locks","Open gates","No security staff"],1,"Visible security discourages crime.");
  m(E,"Which conduct is expected of a watchman?",["Collecting money from visitors","Honesty, alertness and courtesy","Drinking alcohol on duty","Leaving the post unattended"],1,"Integrity is vital in security work.");
  s(E,"What book at the security post records every incident during a shift? (two words)",["occurrence book","incident book","occurrence register"],"Entries create a permanent record.");
  m(E,"Before closing at night, the watchman should check that:",["Windows and doors are open","Doors and windows are locked and lights and electrical appliances are off where required","Visitors are still inside","Gates are open"],1,"End-of-day checks protect the premises.");
  m(M,"If an alarm sounds but no fire is seen, the watchman should:",["Assume it is false and ignore it","Treat it as real, follow the emergency procedure and report","Switch it off and sleep","Leave"],1,"Every alarm is treated as genuine until confirmed.");
  m(E,"A CCTV camera at the gate helps by:",["Replacing all security staff","Recording activity for monitoring and evidence","Opening the gate","Counting money"],1,"It supports, not replaces, guards.");

  /* ---------------- Cleaner ---------------- */
  cadre("Cleaner Cadre");
  m(E,"A detergent is mainly used to:",["Kill all germs","Remove dirt and grease","Polish metal only","Colour surfaces"],1,"Disinfectants kill germs; detergents clean.");
  m(M,"Mixing bleach with ammonia-based cleaners is dangerous because it:",["Cleans better","Releases toxic gas","Smells nice","Saves money"],1,"Never mix cleaning chemicals.");
  m(E,"Wet floor signs should be placed:",["After the floor dries","While mopping and until the floor is dry","Only in toilets","Never"],1,"They prevent slips.");
  m(E,"When cleaning a room, the best order is:",["Bottom to top","Top to bottom, dry tasks before wet tasks","Random","Floor first, then shelves"],1,"Dust falls down; clean high areas first.");
  m(E,"Gloves should be worn when:",["Cleaning toilets and handling chemicals or waste","Answering phones","Reading","Walking"],0,"Protective equipment prevents infection and burns.");
  m(M,"In common colour coding, a red mop or cloth is used for:",["Kitchens","Toilets and sanitary areas","Offices","Glass"],1,"Separate colours stop germs spreading between areas.");
  m(E,"Cleaning chemicals should be stored:",["In food containers","In labelled original containers, away from food and children","Open on shelves","Mixed together"],1,"Labels give safety and dilution information.");
  m(M,"A product label says to dilute 1 part cleaner to 9 parts water. For 10 litres of solution you need:",["1 litre of cleaner","2 litres","0.5 litre","5 litres"],0,"1 + 9 = 10 parts; 10 litres ÷ 10 = 1 litre of cleaner.");
  t(E,"Toilets should be cleaned and disinfected regularly throughout the day in busy offices.",true,"Frequent cleaning prevents disease spread.");
  t(E,"The same cloth can be used to clean toilets and kitchen tables.",false,"This spreads germs.");
  t(M,"Waste should be separated, e.g. recyclables from general waste, where facilities exist.",true,"Separation supports recycling and safer disposal.");
  o(E,"Arrange the steps for cleaning a toilet.",["Put on gloves and place a wet-floor sign","Flush and apply toilet cleaner","Scrub the bowl and seat","Wipe surfaces and handles with disinfectant","Mop the floor and restock supplies"],"Systematic cleaning is thorough and safe.");
  x(E,"Match each tool to its use.",[["Mop","Cleaning floors"],["Duster","Removing dust from surfaces"],["Squeegee","Cleaning glass and windows"],["Dustpan","Collecting swept dirt"]],"Using the right tool saves time.");
  m(E,"If you spill a chemical on your skin, you should:",["Ignore it","Rinse with plenty of clean water and report it","Rub it in","Cover it with cloth"],1,"Rinse immediately; seek help if needed.");
  m(E,"Sharp objects such as broken glass should be:",["Picked up with bare hands","Swept up carefully and placed in a safe container","Left on the floor","Put in a plastic bag loose"],1,"Protect yourself and waste handlers.");
  m(E,"Good personal conduct for cleaners includes:",["Touching officers' documents","Not reading or moving official papers on desks","Taking items from offices","Leaving doors open"],1,"Respect confidentiality and property.");
  s(E,"What sign should be placed on a floor that is being mopped? (two words before 'sign')",["wet floor","wet floor sign","caution wet floor"],"It warns people of slippery floors.");
  m(E,"Dusting with a damp cloth is better than a dry cloth because it:",["Spreads dust","Traps dust instead of scattering it","Damages surfaces","Takes longer"],1,"Damp dusting reduces airborne dust.");
  m(E,"Faulty electrical sockets noticed while cleaning should be:",["Fixed by the cleaner","Reported immediately and not used","Covered with water","Ignored"],1,"Only qualified staff should repair electrical faults.");
  m(E,"Waste bins should be emptied:",["Once a month","Regularly, before they overflow","Never","Only when they smell"],1,"Overflowing bins attract pests.");

  /* ---------------- Gardener ---------------- */
  cadre("Gardener Cadre");
  m(E,"The best times of day to water plants are:",["Midday","Early morning or late evening","Midnight only","Never"],1,"Less water is lost to evaporation.");
  m(E,"Compost is made from:",["Plastic waste","Decomposed organic matter such as leaves and food scraps","Stones","Metal"],1,"Compost improves soil structure and fertility.");
  m(M,"In fertiliser labels, NPK stands for:",["Nitrogen, Phosphorus, Potassium","Nickel, Potash, Kerosene","Natural Plant Kit","Nitrate, Peat, Kelp"],0,"These are the three main plant nutrients.");
  m(M,"Nitrogen in fertiliser mainly promotes:",["Root growth","Leafy green growth","Flowering only","Seed hardness"],1,"Phosphorus helps roots; potassium aids flowering and fruiting.");
  m(E,"Mulching around plants helps to:",["Kill plants","Retain soil moisture and suppress weeds","Attract pests only","Harden soil"],1,"Organic mulch also adds nutrients as it decays.");
  m(E,"Pruning is done to:",["Kill shrubs","Remove dead or unwanted branches and shape plants","Water plants","Plant seeds"],1,"Pruning improves health and appearance.");
  m(M,"Propagating a plant by planting a cut piece of stem is called:",["Grafting","Taking cuttings","Budding","Seeding"],1,"Cuttings root to form new plants.");
  m(E,"The main rainy season in Lagos usually runs from about:",["November to February","April to October","December to March","January only"],1,"There is a short dry spell around August.");
  m(M,"Sandy soil:",["Holds water very well","Drains quickly and holds few nutrients","Is sticky when wet","Is always the best soil"],1,"Adding organic matter improves sandy soil.");
  m(M,"Clay soil:",["Drains very fast","Holds water and nutrients but can become waterlogged and compacted","Has no nutrients","Is the same as sand"],1,"Loam (a mix) is generally best for most plants.");
  t(E,"When using herbicides or pesticides, gloves and protective clothing should be worn.",true,"These chemicals can harm health.");
  t(E,"Garden tools should be cleaned and stored properly after use.",true,"This prevents rust and spread of plant disease.");
  t(M,"Cutting grass very short is always best for a healthy lawn.",false,"Very short mowing stresses grass and encourages weeds.");
  o(E,"Arrange the steps for planting a young shrub.",["Dig a hole wider than the root ball","Mix compost into the soil","Place the plant at the same depth it was growing","Backfill and firm the soil","Water thoroughly"],"Good planting gives roots a strong start.");
  x(E,"Match each garden tool to its use.",[["Cutlass","Clearing grass and bush"],["Hoe","Weeding and loosening soil"],["Rake","Gathering leaves and levelling soil"],["Watering can","Watering plants"]],"Common tools of the gardener.");
  m(E,"Weeds should be removed because they:",["Help plants grow","Compete with plants for water, light and nutrients","Are always poisonous","Look colourful"],1,"Regular weeding protects cultivated plants.");
  m(E,"Plants make their food through:",["Respiration","Photosynthesis","Transpiration","Germination"],1,"Using sunlight, water and carbon dioxide.");
  s(E,"What is the name for decomposed organic matter used to improve soil?",["compost","manure"],"Compost and manure both enrich soil.");
  m(M,"Yellowing leaves on many plants can indicate:",["Too much sunlight only","Nutrient deficiency (e.g. nitrogen) or overwatering","Perfect health","Cold weather"],1,"Diagnose the cause before treating.");
  m(E,"Flower beds near office buildings should be kept:",["Overgrown","Neat, weeded and free of stagnant water","Full of refuse","Unwatered"],1,"Stagnant water breeds mosquitoes.");

  for(var n in out)out[n].forEach(function(z){z.scope=n;});
  return out;
})();


/* ==================== inlined from cbt-bank-prof-health.js ==================== */
/* ============================================================
   PROFESSIONAL KNOWLEDGE — health cadres.
   20 questions per cadre. Shared file (browser + Apps Script).
   Clinical content reflects widely taught standards (WHO / national
   guidelines); confirm against the current national protocols.
   ============================================================ */
var SEED_PROF_HEALTH=(function(){
  var out={},cur=null,C="Professional Knowledge",E="easy",M="medium",H="hard";
  function cadre(n){cur=out[n]=[];}
  function q(t,d,stem,x,ex){var o={scope:null,category:C,type:t,difficulty:d,stem:stem,explanation:ex};for(var k in x)o[k]=x[k];cur.push(o);}
  function m(d,stem,o,a,ex){q("mcq",d,stem,{options:o,answer:a},ex);}
  function t(d,stem,a,ex){q("truefalse",d,stem,{answer:a},ex);}
  function s(d,stem,acc,ex){q("shortanswer",d,stem,{accept:acc},ex);}
  function o(d,stem,items,ex){q("ordering",d,stem,{items:items},ex);}
  function x(d,stem,pairs,ex){q("matching",d,stem,{pairs:pairs.map(function(p){return {l:p[0],r:p[1]};})},ex);}

  /* ---------------- Medical Officer ---------------- */
  cadre("Medical Officer Cadre");
  m(M,"The recommended first-line treatment for uncomplicated falciparum malaria in Nigeria is:",["Chloroquine","An artemisinin-based combination therapy (e.g. artemether-lumefantrine)","Quinine injection only","Sulfadoxine-pyrimethamine alone"],1,"ACTs are first line; chloroquine is no longer effective against P. falciparum.");
  m(M,"The preferred initial treatment for severe malaria is:",["Oral ACT","Parenteral artesunate","Chloroquine syrup","Paracetamol only"],1,"IV/IM artesunate reduces mortality compared with quinine.");
  m(E,"The recommended management of acute watery diarrhoea in children includes:",["Antibiotics for all cases","Low-osmolarity ORS plus zinc supplementation","Withholding fluids","Anti-diarrhoeal drugs"],1,"ORS corrects dehydration; zinc reduces duration and severity.");
  m(M,"The Glasgow Coma Scale ranges from:",["0 to 10","1 to 5","3 to 15","5 to 20"],2,"3 is the lowest (deep coma); 15 is fully alert.");
  m(M,"The natural reservoir of Lassa fever virus is the:",["Aedes mosquito","Multimammate rat (Mastomys natalensis)","Fruit bat","Domestic dog"],1,"Transmission is via contact with rodent excreta or infected body fluids.");
  m(M,"The antiviral drug used in the treatment of Lassa fever is:",["Ribavirin","Acyclovir","Oseltamivir","Zidovudine"],0,"Ribavirin is most effective when started early.");
  m(H,"The standard regimen for new drug-susceptible pulmonary tuberculosis lasts:",["2 months","6 months (2 months intensive, 4 months continuation)","12 months","3 weeks"],1,"2HRZE/4HR under directly observed treatment.");
  m(E,"Body Mass Index is calculated as:",["Height ÷ weight","Weight (kg) ÷ height (m)²","Weight × height","Waist ÷ hip"],1,"A BMI of 18.5–24.9 is the normal range.");
  m(M,"A patient weighs 81 kg and is 1.8 m tall. The BMI is:",["20","25","30","45"],1,"81 ÷ (1.8 × 1.8) = 81 ÷ 3.24 = 25.");
  m(M,"Hypertension in adults is generally diagnosed at a blood pressure of:",["≥120/80 mmHg","≥140/90 mmHg on repeated measurements","≥100/60 mmHg","≥160/110 only"],1,"Repeated readings at or above 140/90 confirm hypertension (some guidelines use lower cut-offs).");
  m(M,"The body that registers and regulates medical doctors in Nigeria is the:",["Nursing and Midwifery Council","Medical and Dental Council of Nigeria (MDCN)","Pharmacy Council","NAFDAC"],1,"Practising without MDCN registration is unlawful.");
  m(M,"The Lagos State Health Management Agency (LASHMA) administers the State's health insurance scheme known as:",["Ilera Eko","Eko Care Plus","NHIS-Lagos","Lagos Cares"],0,"Ilera Eko is the Lagos State Health Scheme.");
  x(M,"Match each disease to its vector.",[["Malaria","Female Anopheles mosquito"],["Yellow fever","Aedes mosquito"],["Onchocerciasis (river blindness)","Blackfly (Simulium)"],["Sleeping sickness","Tsetse fly"]],"Vector control is central to preventing these diseases.");
  o(M,"Arrange the ABCDE approach to assessing an acutely ill patient.",["Airway","Breathing","Circulation","Disability (neurological status)","Exposure"],"Problems are treated as they are found, in this order.");
  t(M,"Informed consent requires that the patient understands the nature, risks, benefits and alternatives of a procedure and agrees voluntarily.",true,"Consent obtained without understanding or under pressure is not valid.");
  t(E,"Confidential patient information may be shared freely with the patient's employer.",false,"Disclosure needs consent or a legal basis.");
  t(M,"Cholera typically presents with profuse 'rice-water' stools and rapid dehydration.",true,"Rapid rehydration is life-saving.");
  m(M,"Suspected cases of epidemic-prone diseases (e.g. Lassa fever, cholera) must be reported through the disease surveillance system coordinated nationally by the:",["NCDC (Nigeria Centre for Disease Control and Prevention)","NAFDAC","NHIA","MDCN"],0,"Notification triggers outbreak investigation and response.");
  s(M,"In the APGAR score, what does the 'P' stand for?",["pulse","pulse rate","heart rate"],"APGAR: Appearance, Pulse, Grimace, Activity, Respiration.");
  m(H,"The National Health Insurance Authority Act 2022:",["Abolished health insurance","Replaced the NHIS with the NHIA and made health insurance mandatory for Nigerians","Applies only to the military","Covers only federal workers"],1,"States run their own schemes in coordination with the NHIA.");

  /* ---------------- Nursing Officer ---------------- */
  cadre("Nursing Officer Cadre");
  o(M,"Arrange the steps of the nursing process in order.",["Assessment","Nursing diagnosis","Planning","Implementation","Evaluation"],"Often remembered as ADPIE.");
  m(M,"Nurses and midwives in Nigeria are registered and regulated by the:",["MDCN","Nursing and Midwifery Council of Nigeria (NMCN)","Pharmacy Council","Health Records Board"],1,"NMCN sets standards and licenses practitioners.");
  m(M,"Which is NOT one of the 'rights' of medication administration?",["Right patient","Right dose","Right route","Right price"],3,"The rights include right patient, drug, dose, route, time and documentation.");
  m(M,"To prevent pressure ulcers in a bedridden patient, the patient should be repositioned at least every:",["2 hours","8 hours","12 hours","24 hours"],0,"Regular turning relieves pressure on bony prominences.");
  m(M,"A patient with difficulty breathing is best nursed in the:",["Prone position","Fowler's (semi-sitting) position","Trendelenburg position","Lithotomy position"],1,"Upright positioning eases lung expansion.");
  m(E,"The normal adult respiratory rate at rest is about:",["4–8 breaths per minute","12–20 breaths per minute","30–40 breaths per minute","50–60 breaths per minute"],1,"Rates outside this range need assessment.");
  m(M,"A doctor orders 500 mg of a drug. The stock is 250 mg in 5 ml. What volume should be given?",["2.5 ml","5 ml","10 ml","20 ml"],2,"(500 ÷ 250) × 5 ml = 10 ml.");
  m(H,"1,000 ml of IV fluid is to run over 8 hours using a giving set with a drop factor of 20 drops/ml. The drip rate is about:",["21 drops/min","42 drops/min","63 drops/min","125 drops/min"],1,"(1,000 × 20) ÷ (8 × 60) = 20,000 ÷ 480 ≈ 42 drops/min.");
  m(E,"After giving an injection, a used needle should be:",["Recapped with two hands","Placed directly into a puncture-proof sharps container without recapping","Thrown into a general bin","Reused"],1,"Recapping causes needle-stick injuries.");
  m(M,"An infection acquired by a patient while in hospital is called:",["Congenital","Nosocomial (healthcare-associated)","Zoonotic","Endemic"],1,"Hand hygiene is the main preventive measure.");
  m(M,"The SBAR tool is used for:",["Measuring blood pressure","Structured handover communication: Situation, Background, Assessment, Recommendation","Calculating drug doses","Wound dressing"],1,"SBAR improves clarity and patient safety.");
  x(M,"Match each patient position to its use.",[["Recovery position","Unconscious, breathing patient"],["Fowler's","Breathing difficulty"],["Supine","Lying flat on the back for examination"],["Lithotomy","Gynaecological examination or delivery"]],"Positioning supports comfort, safety and procedures.");
  t(E,"In nursing practice, care that is not documented is regarded as not done.",true,"Records are legal evidence of care.");
  t(M,"The WHO 'Five Moments for Hand Hygiene' include before touching a patient and after touching patient surroundings.",true,"Also before aseptic procedures, after body-fluid exposure and after touching a patient.");
  t(M,"A nurse should administer a drug prepared by a colleague without checking it.",false,"Nurses administer only drugs they have checked themselves.");
  m(M,"The deltoid muscle is suitable for intramuscular injections of:",["Large volumes (over 5 ml)","Small volumes, typically up to about 1 ml (e.g. vaccines)","All drugs","Only oily drugs"],1,"Larger volumes go into the ventrogluteal or vastus lateralis sites.");
  m(E,"The normal adult body temperature is approximately:",["32–33°C","36.5–37.5°C","39–40°C","41–42°C"],1,"Above about 38°C is fever.");
  s(M,"What does the letter 'E' stand for at the end of the nursing process (ADPIE)?",["evaluation"],"Evaluation checks whether goals were met.");
  m(H,"Using Maslow's hierarchy to prioritise care, which need is attended to first?",["Self-esteem","Airway and breathing (physiological needs)","Social belonging","Self-actualisation"],1,"Physiological needs come before safety and psychosocial needs.");
  m(M,"A patient refuses a prescribed medication. The nurse should:",["Hide it in food","Respect the refusal, explain the implications, document it and inform the doctor","Force the patient","Ignore the order"],1,"Competent adults have the right to refuse treatment.");

  /* ---------------- Midwifery ---------------- */
  cadre("Midwifery Cadre");
  m(M,"Using Naegele's rule, a woman whose last menstrual period began on 10 January 2026 has an expected date of delivery of:",["3 October 2026","17 October 2026","10 October 2026","17 November 2026"],1,"Add 7 days and subtract 3 months (+1 year): 10 Jan → 17 Oct 2026.");
  o(M,"Arrange the stages of labour in order.",["First stage: cervical dilatation to full (10 cm)","Second stage: birth of the baby","Third stage: delivery of the placenta and membranes","Fourth stage: first hour after delivery (observation)"],"The fourth stage is the period of greatest risk of postpartum haemorrhage.");
  m(M,"The partograph is used to:",["Record antenatal visits","Monitor the progress of labour and maternal/fetal condition","Calculate EDD","Record immunisations"],1,"Crossing the alert line prompts action or referral.");
  m(M,"Active management of the third stage of labour includes:",["Waiting for natural delivery of the placenta only","A uterotonic (e.g. oxytocin 10 IU IM), controlled cord traction and uterine massage","Pulling the cord immediately after birth","Bed rest only"],1,"It reduces postpartum haemorrhage.");
  m(M,"Primary postpartum haemorrhage after vaginal birth is commonly defined as blood loss of at least:",["100 ml","250 ml","500 ml","2,000 ml"],2,"PPH is a leading cause of maternal death.");
  m(M,"The drug of choice to prevent and treat eclamptic seizures is:",["Diazepam","Magnesium sulphate","Phenobarbitone","Paracetamol"],1,"Magnesium sulphate is superior to diazepam for eclampsia.");
  m(E,"Exclusive breastfeeding is recommended for the first:",["6 weeks","3 months","6 months","12 months"],2,"No other food or water is needed in the first 6 months.");
  m(M,"The WHO 2016 antenatal care model recommends a minimum of:",["4 contacts","8 contacts","2 contacts","12 contacts"],1,"Eight contacts improve outcomes compared with the old four-visit model.");
  m(M,"Folic acid supplementation before and in early pregnancy mainly prevents:",["Malaria","Neural tube defects","Twins","Hypertension"],1,"E.g. spina bifida.");
  m(M,"Intermittent preventive treatment of malaria in pregnancy (IPTp) uses:",["Chloroquine","Sulfadoxine-pyrimethamine","Artesunate injection","Quinine"],1,"Given from the second trimester at antenatal contacts.");
  m(E,"Kangaroo mother care involves:",["Bottle feeding","Continuous skin-to-skin contact between mother and low-birth-weight baby","Keeping the baby in a cot","Carrying baby on the back"],1,"It keeps the baby warm and supports breastfeeding.");
  m(M,"Chlorhexidine gel (7.1% chlorhexidine digluconate) applied to the umbilical cord stump is used to:",["Speed up cord separation only","Reduce neonatal cord infection and sepsis","Stop bleeding","Treat jaundice"],1,"Nigeria adopted chlorhexidine cord care.");
  x(M,"Match each pregnancy danger sign to a possible cause.",[["Severe headache with blurred vision","Pre-eclampsia"],["Vaginal bleeding in late pregnancy","Placenta praevia or abruption"],["Fever with foul vaginal discharge after birth","Puerperal sepsis"],["Reduced fetal movements","Fetal distress"]],"Danger signs require urgent referral.");
  t(E,"A normal full-term pregnancy lasts about 37 to 42 weeks.",true,"Birth before 37 weeks is preterm.");
  t(M,"In the APGAR score, a score of 7–10 at 5 minutes is generally reassuring.",true,"Low scores call for resuscitation and monitoring.");
  t(M,"Prevention of mother-to-child transmission (PMTCT) of HIV is no longer necessary when the mother takes antiretroviral therapy.",false,"ART is the core of PMTCT; testing, infant prophylaxis and feeding counselling continue.");
  m(M,"Delayed cord clamping (about 1–3 minutes) in a healthy newborn mainly helps to:",["Increase infection","Improve the baby's iron stores","Speed up placenta delivery","Reduce breastfeeding"],1,"It transfers additional blood to the baby.");
  s(M,"How many centimetres of cervical dilatation define full dilatation? (number only)",["10","10cm","10 cm"],"Full dilatation marks the end of the first stage of labour.");
  m(H,"A woman is 3 hours into the active phase and her partograph plot crosses the alert line. The midwife should:",["Ignore it","Reassess and, depending on the setting, prepare for intervention or referral","Discharge her","Give food only"],1,"The alert line signals slow progress requiring action.");
  m(M,"The main purpose of postnatal visits is to:",["Collect fees","Check mother and baby for complications, support breastfeeding and offer family planning","Register births only","Give vaccines to the mother only"],1,"Most maternal and newborn deaths occur soon after birth.");

  /* ---------------- Community Health ---------------- */
  cadre("Community Health Cadre");
  m(M,"The Alma-Ata Declaration (1978) is famous for promoting:",["Hospital building","Primary Health Care as the key to 'Health for All'","Private health insurance","Specialist care only"],1,"PHC is essential care that is accessible, affordable and community-based.");
  m(E,"At birth, a Nigerian baby should receive:",["Measles vaccine","BCG, OPV0 and Hepatitis B birth dose","Yellow fever vaccine","Meningitis vaccine"],1,"These are given at or soon after birth.");
  m(M,"Vaccines in the cold chain should normally be stored at:",["−20°C to −10°C for all vaccines","+2°C to +8°C (most vaccines)","+15°C to +25°C","Room temperature"],1,"Some vaccines (e.g. OPV) may be kept frozen at higher levels of the chain.");
  m(M,"The measles vaccine is given in Nigeria's routine schedule at:",["Birth","6 weeks","9 months (with a second dose later)","5 years"],2,"A second dose is given at 15 months in the updated schedule.");
  m(M,"'Primary Health Care Under One Roof' (PHCUOR) means:",["One building for all hospitals","Integrating the management of all PHC services under one authority (e.g. a State PHC Board)","Closing PHC centres","Free drugs only"],1,"It reduces fragmentation of PHC services.");
  m(M,"Incidence refers to:",["All existing cases at a point in time","New cases occurring in a population over a period","Deaths only","Recovered cases"],1,"Prevalence counts all existing cases.");
  m(M,"Herd immunity occurs when:",["Only animals are vaccinated","Enough of the population is immune that spread is interrupted, protecting the unvaccinated","Everyone is infected","Vaccines are stopped"],1,"High coverage protects vulnerable people.");
  m(M,"The Integrated Disease Surveillance and Response (IDSR) strategy aims to:",["Build hospitals","Detect, report and respond to priority diseases efficiently","Train doctors only","Replace immunisation"],1,"Community health workers report suspected cases.");
  m(E,"Growth monitoring of under-fives uses a:",["Partograph","Growth chart (road-to-health card)","Bin card","Vote book"],1,"Faltering growth signals malnutrition or illness.");
  m(E,"The most effective way to prevent malaria at household level is:",["Sleeping under insecticide-treated nets and removing breeding sites","Taking antibiotics","Drinking more water","Closing doors in the afternoon"],0,"ITNs reduce malaria transmission and deaths.");
  x(E,"Match each vaccine to the disease it prevents.",[["BCG","Tuberculosis"],["OPV/IPV","Poliomyelitis"],["Pentavalent","Diphtheria, pertussis, tetanus, Hep B and Hib"],["MCV","Measles"]],"Know the routine immunisation schedule.");
  o(M,"Arrange the steps of a community diagnosis.",["Entry into the community and meeting leaders","Data collection (survey, observation)","Analysis and identification of health problems","Prioritisation with the community","Planning and implementing interventions","Evaluation"],"Community participation runs through every step.");
  t(E,"Boiling water for at least one minute at a rolling boil makes it safe from most disease-causing germs.",true,"Boiling is a simple household water treatment.");
  t(M,"Ward Development Committees help communities participate in planning and monitoring PHC services.",true,"They link communities with health facilities.");
  t(M,"Health education is most effective when it uses fear alone, without practical advice.",false,"Practical, culturally appropriate messages work better.");
  m(M,"A community of 20,000 people records 600 live births in a year. The crude birth rate is:",["3 per 1,000","30 per 1,000","300 per 1,000","0.3 per 1,000"],1,"(600 ÷ 20,000) × 1,000 = 30 per 1,000.");
  m(E,"Homemade salt-sugar solution, if ORS is unavailable, is traditionally made with 1 litre of clean water,:",["Half a level teaspoon of salt and six level teaspoons of sugar","Six teaspoons of salt and one of sugar","Only sugar","Only salt"],0,"Correct proportions matter; packaged ORS is preferred.");
  s(E,"What does 'PHC' stand for? (three words)",["primary health care","primary healthcare"],"PHC is the first level of contact with the health system.");
  m(M,"Lagos State primary health care services are managed by the:",["Lagos State Primary Health Care Board","LASUTH","LASEPA","NHIA"],0,"The Board coordinates PHC centres across LGAs/LCDAs.");
  m(M,"Which is a primary prevention activity?",["Treating diabetes complications","Immunisation","Physiotherapy after stroke","Surgery for cancer"],1,"Primary prevention stops disease occurring; secondary detects early; tertiary limits disability.");

  /* ---------------- Pharmacy ---------------- */
  cadre("Pharmacy Cadre");
  m(M,"Pharmacists and pharmacy premises in Nigeria are regulated by the:",["NAFDAC only","Pharmacy Council of Nigeria (PCN)","MDCN","NMCN"],1,"NAFDAC regulates products; PCN regulates practice and premises.");
  x(M,"Match each prescription abbreviation to its meaning.",[["bd","Twice daily"],["tds","Three times daily"],["prn","When required"],["stat","Immediately"]],"Correct interpretation prevents dosing errors.");
  m(M,"A prescription reads amoxicillin 500 mg tds for 5 days. The pharmacy has 250 mg capsules. How many capsules are needed?",["15","20","30","60"],2,"2 capsules × 3 times × 5 days = 30.");
  m(M,"The antidote for paracetamol overdose is:",["Naloxone","N-acetylcysteine","Atropine","Vitamin K"],1,"It is most effective when given early.");
  m(M,"The antidote for opioid overdose is:",["Flumazenil","Naloxone","Protamine","Glucagon"],1,"Naloxone reverses respiratory depression.");
  m(M,"Drugs in a pharmacy store are best issued by:",["LIFO","FEFO — First Expiry, First Out","Random selection","Alphabetical order"],1,"FEFO minimises expiry losses.");
  m(M,"Most vaccines and insulin (unopened) should be stored at:",["Room temperature","2–8°C in a refrigerator","Frozen at −20°C","Above 30°C"],1,"Freezing damages many vaccines and insulin.");
  m(M,"NAFDAC's Mobile Authentication Service (MAS) allows consumers to:",["Order drugs online","Verify a product's authenticity by sending a scratch code by SMS","Get prescriptions","Report doctors"],1,"It helps fight counterfeit medicines.");
  m(M,"Pharmacovigilance is concerned with:",["Drug advertising","Detecting, assessing and preventing adverse drug reactions","Drug pricing","Pharmacy building design"],1,"Health workers report ADRs to NAFDAC.");
  m(H,"After about how many half-lives is a drug considered largely eliminated from the body?",["1","2","4 to 5","20"],2,"After 4–5 half-lives, about 94–97% has been eliminated (and steady state is reached on regular dosing).");
  m(M,"First-line oral medicine for most adults with type 2 diabetes is usually:",["Insulin","Metformin","Glibenclamide only","Aspirin"],1,"Unless contraindicated (e.g. severe renal impairment).");
  m(M,"Antimicrobial stewardship aims to:",["Increase antibiotic sales","Promote appropriate antibiotic use to slow resistance","Ban antibiotics","Replace vaccines"],1,"Right drug, dose, duration and only when needed.");
  t(E,"A generic medicine contains the same active ingredient as the branded original.",true,"It must be bioequivalent to the original.");
  t(M,"Controlled drugs such as morphine must be recorded in a controlled drugs register and stored securely.",true,"Strict records prevent diversion.");
  t(M,"Expired drugs may be dispensed if they look fine.",false,"Expired drugs may be less effective or harmful.");
  o(M,"Arrange the steps of dispensing a prescription.",["Receive and check the prescription for validity","Interpret and check dose and interactions","Select and prepare the medicine","Label correctly","Counsel the patient and hand over","Record the transaction"],"Each step catches errors before the patient takes the medicine.");
  m(M,"The Drug Revolving Fund (DRF) system in public facilities is meant to:",["Give all drugs free","Sustain drug availability by recovering costs to restock","Close pharmacies","Fund salaries"],1,"Proceeds from sales restock the pharmacy.");
  s(E,"What does the prescription abbreviation 'od' mean? (two words)",["once daily","once a day"],"'od' = once daily.");
  m(M,"The WHO Essential Medicines List is:",["A list of banned drugs","A list of medicines that meet priority health needs and should be available at all times","A price list","A list of herbal drugs"],1,"Countries adapt it into national lists.");
  m(H,"Bioavailability refers to:",["The drug's price","The proportion of an administered dose that reaches the systemic circulation unchanged","The drug's shelf life","The number of tablets"],1,"IV drugs have 100% bioavailability.");

  /* ---------------- Medical Laboratory Science ---------------- */
  cadre("Medical Laboratory Science Cadre");
  m(M,"Medical laboratory scientists in Nigeria are regulated by the:",["MDCN","Medical Laboratory Science Council of Nigeria (MLSCN)","PCN","NMCN"],1,"MLSCN registers practitioners and accredits laboratories.");
  m(E,"In Gram staining, Gram-positive bacteria appear:",["Pink/red","Purple/violet","Green","Yellow"],1,"Gram-negative bacteria stain pink/red with the counterstain.");
  o(M,"Arrange the steps of the Gram stain in order.",["Crystal violet (primary stain)","Gram's iodine (mordant)","Alcohol/acetone (decolouriser)","Safranin (counterstain)"],"Decolourisation differentiates the two groups.");
  m(M,"For malaria microscopy, the thick film is mainly used to:",["Identify the species","Detect parasites (higher sensitivity)","Count white cells","Measure haemoglobin"],1,"The thin film is used for species identification.");
  x(M,"Match each blood collection tube to its main use.",[["EDTA (purple/lavender)","Full blood count"],["Sodium citrate (light blue)","Coagulation tests"],["Fluoride oxalate (grey)","Blood glucose"],["Plain (red)","Serum chemistry and serology"]],"Using the wrong tube invalidates results.");
  m(M,"A normal fasting plasma glucose in adults is approximately:",["1.0–2.0 mmol/L","3.9–5.6 mmol/L","8.0–10.0 mmol/L","12–15 mmol/L"],1,"≥7.0 mmol/L on repeat testing suggests diabetes.");
  m(M,"The 'universal red cell donor' blood group is:",["AB positive","O negative","A positive","B negative"],1,"AB positive is the universal recipient.");
  m(M,"Standard autoclave sterilisation conditions are about:",["60°C for 5 minutes","121°C at about 15 psi for at least 15 minutes","100°C for 1 minute","200°C dry heat for 1 minute"],1,"Steam under pressure kills spores.");
  m(M,"A Levey-Jennings chart is used in laboratory:",["Inventory","Quality control, plotting control results over time","Staff rostering","Billing"],1,"Westgard rules help interpret QC trends.");
  m(M,"A person with haemoglobin genotype AS is:",["Sickle cell disease","A sickle cell carrier (trait)","Normal AA","Thalassaemia major"],1,"Two AS parents have a 1 in 4 chance per pregnancy of an SS child.");
  m(M,"The Widal test for typhoid is limited mainly because:",["It is too expensive","It has poor specificity and sensitivity, especially in endemic areas","It takes weeks","It needs CT scans"],1,"Blood culture is the reference test.");
  m(M,"When using a centrifuge, tubes must be:",["Placed randomly","Balanced opposite each other","Uncapped","Overfilled"],1,"Imbalance damages the centrifuge and risks aerosols.");
  t(E,"Specimens should be labelled at the time of collection in the presence of the patient.",true,"This prevents mix-ups.");
  t(M,"Mouth pipetting is acceptable when no pipette filler is available.",false,"Mouth pipetting is prohibited; it risks infection and poisoning.");
  t(M,"The 100× oil-immersion objective is used to examine stained blood films and bacteria.",true,"Immersion oil improves resolution.");
  m(M,"Biosafety cabinets are used mainly to:",["Store reagents","Protect the worker, sample and environment from infectious aerosols","Cool samples","Dry slides"],1,"Class II cabinets are common in clinical labs.");
  s(M,"What colour do Gram-negative bacteria stain? (one word)",["pink","red"],"They take up the safranin counterstain.");
  m(H,"A haemolysed blood sample would falsely raise which result?",["Sodium","Potassium","Glucose","Albumin"],1,"Red cells contain high potassium, released on haemolysis.");
  m(M,"The erythrocyte sedimentation rate (ESR) is:",["A specific test for one disease","A non-specific marker of inflammation","A blood group test","A glucose test"],1,"It rises in many inflammatory conditions.");
  m(M,"Before reporting an abnormal critical result (e.g. very low haemoglobin), the scientist should:",["Wait for routine rounds","Verify it and communicate it promptly to the clinician, documenting the call","Delete it","Change it to normal"],1,"Critical values need urgent action.");

  /* ---------------- Radiography ---------------- */
  cadre("Radiography Cadre");
  m(M,"Radiographers in Nigeria are registered by the:",["MDCN","Radiographers Registration Board of Nigeria (RRBN)","NMCN","MLSCN"],1,"RRBN regulates radiography practice.");
  m(E,"X-rays were discovered by:",["Marie Curie","Wilhelm Röntgen (1895)","Isaac Newton","Louis Pasteur"],1,"Röntgen received the first Nobel Prize in Physics in 1901.");
  m(M,"The ALARA principle in radiation protection means:",["As Long As Reasonably Allowed","As Low As Reasonably Achievable","Always Limit All Radiation Absolutely","Avoid Lead At Risky Areas"],1,"Keep doses as low as reasonably achievable.");
  m(H,"According to the inverse square law, if the distance from a radiation source is doubled, the intensity becomes:",["Half","One quarter","Double","Unchanged"],1,"Intensity ∝ 1/distance²; doubling distance gives 1/4.");
  m(M,"The SI unit of effective dose is the:",["Gray","Sievert","Becquerel","Roentgen"],1,"The gray is the unit of absorbed dose.");
  m(M,"Radiation workers wear a TLD badge to:",["Identify themselves","Monitor their personal radiation dose","Shield the body","Measure temperature"],1,"Thermoluminescent dosimeters record cumulative dose.");
  m(M,"Which imaging modality does NOT use ionising radiation?",["CT","Plain X-ray","MRI","Fluoroscopy"],2,"MRI uses magnetic fields and radio waves; ultrasound uses sound.");
  m(M,"A standard chest X-ray is usually taken:",["AP lying down","PA erect, on full inspiration","Lateral only","On expiration"],1,"PA reduces heart magnification; inspiration expands the lungs.");
  m(M,"In CT, water has a Hounsfield value of:",["−1000","0","+1000","+100"],1,"Air is about −1000; dense bone around +1000.");
  m(M,"Before an abdominal or pelvic X-ray on a woman of reproductive age, the radiographer should:",["Ignore pregnancy","Ask about possible pregnancy/LMP according to the department's protocol","Use maximum dose","Skip the request form"],1,"Protects a possible fetus from unnecessary exposure.");
  m(M,"Increasing kVp mainly affects:",["The quantity of X-rays only","The penetrating power (energy) of the beam and image contrast","The patient's name","Film size"],1,"mAs mainly controls the quantity of radiation.");
  m(M,"The regulator responsible for radiation safety and licensing of radiation sources in Nigeria is the:",["NNRA (Nigerian Nuclear Regulatory Authority)","NAFDAC","NCC","SON"],0,"Diagnostic X-ray facilities must comply with NNRA requirements.");
  x(M,"Match each contrast agent or method to its typical use.",[["Barium sulphate","Gastrointestinal studies"],["Iodinated contrast","CT and angiography"],["Gadolinium","MRI"],["Microbubbles","Contrast-enhanced ultrasound"]],"Each modality uses different contrast agents.");
  t(E,"Lead aprons reduce the radiation dose to staff and patients from scattered radiation.",true,"Shielding is a basic protection measure.");
  t(M,"A patient with certain pacemakers or ferromagnetic implants may be unsafe for MRI.",true,"Screening for implants is mandatory before MRI.");
  t(M,"Ultrasound exposes the fetus to ionising radiation.",false,"Ultrasound uses sound waves, not ionising radiation.");
  o(M,"Arrange the steps of a routine X-ray examination in order.",["Verify the request and identify the patient","Explain the procedure and remove metal objects","Position the patient and collimate the beam","Apply shielding and make the exposure","Check image quality and record exposure factors"],"Correct ID, justification, collimation and shielding keep exams safe and diagnostic.");
  s(M,"What does 'CT' stand for? (two words)",["computed tomography","computerised tomography","computerized tomography"],"CT produces cross-sectional images using X-rays.");
  m(M,"Before giving iodinated contrast, the radiographer should check for:",["Hair colour","History of contrast allergy and kidney function","Blood group","Shoe size"],1,"Contrast reactions and nephropathy are key risks.");
  m(H,"Collimating the X-ray beam to the area of interest:",["Increases patient dose","Reduces patient dose and scatter, improving image quality","Has no effect","Only saves film"],1,"Tight collimation is a key dose-reduction measure.");

  /* ---------------- Physiotherapy ---------------- */
  cadre("Physiotherapy Cadre");
  m(M,"Physiotherapists in Nigeria are registered by the:",["MDCN","Medical Rehabilitation Therapists (Registration) Board of Nigeria","NMCN","PCN"],1,"The Board registers physiotherapists, occupational therapists and others.");
  m(E,"RICE, used for acute soft-tissue injuries, stands for:",["Run, Ice, Cool, Exercise","Rest, Ice, Compression, Elevation","Rub, Inject, Cover, Elevate","Rest, Inspect, Cast, Exercise"],1,"Newer guidance (e.g. PEACE & LOVE) adds education and gradual loading.");
  m(M,"A goniometer is used to measure:",["Muscle strength","Joint range of motion (angles)","Blood pressure","Heart rate"],1,"It records joint angles in degrees.");
  m(M,"On the Oxford (MRC) muscle strength scale, grade 3 means:",["No contraction","Flicker of contraction","Full range of movement against gravity but not against resistance","Normal power"],2,"Grades run from 0 (none) to 5 (normal).");
  m(M,"Isometric exercise involves:",["Muscle contraction without joint movement","Rapid movement","Stretching only","Walking"],0,"Isotonic exercise involves movement through range.");
  m(M,"Passive range-of-motion exercises are performed:",["By the patient alone","By the therapist moving the limb without the patient's muscle effort","With weights","In water only"],1,"Used when patients cannot move actively.");
  m(M,"TENS is mainly used for:",["Muscle building","Pain relief","Bone healing","Wound cleaning"],1,"Transcutaneous electrical nerve stimulation modulates pain signals.");
  m(M,"Postural drainage and chest percussion are used to:",["Strengthen legs","Help clear secretions from the lungs","Reduce blood pressure","Treat fractures"],1,"Common in cystic fibrosis, bronchiectasis and post-operative care.");
  m(M,"Heat therapy should be avoided over areas with:",["Normal sensation","Impaired sensation or active malignancy","Healthy skin","Mild stiffness"],1,"Patients may not feel burns; heat may affect tumour tissue.");
  m(M,"After a stroke, early rehabilitation aims to:",["Keep the patient in bed","Maximise functional recovery, prevent complications and promote independence","Avoid movement of the affected side","Only give drugs"],1,"Early, task-oriented therapy improves outcomes.");
  m(M,"A patient told to be 'non-weight-bearing' on the left leg after fracture should:",["Walk normally","Use crutches without putting any weight through the left leg","Put half weight","Run"],1,"Weight-bearing status protects healing structures.");
  m(E,"Safe lifting technique includes:",["Bending the back with straight legs","Bending the knees, keeping the back straight and the load close","Twisting while lifting","Lifting quickly with jerks"],1,"Good ergonomics prevents back injury.");
  x(M,"Match each condition to a typical physiotherapy goal.",[["Frozen shoulder","Restore shoulder range of motion"],["Cerebral palsy","Improve posture, mobility and function"],["Low back pain","Reduce pain and restore activity"],["Total knee replacement","Regain knee movement and walking"]],"Goals are tailored to each condition.");
  t(E,"Exercise prescription should consider the patient's condition, goals and tolerance.",true,"Individualised programmes are safer and more effective.");
  t(M,"Hydrotherapy uses the properties of water, such as buoyancy, to aid exercise.",true,"Buoyancy reduces load on joints.");
  t(M,"Pain during every exercise is always a sign of progress and should be ignored.",false,"Pain must be monitored; sharp or worsening pain needs reassessment.");
  o(M,"Arrange the parts of a SOAP clinical note.",["Subjective","Objective","Assessment","Plan"],"SOAP structures assessment records.");
  s(E,"What instrument measures joint angles in degrees?",["goniometer","a goniometer"],"Goniometry tracks progress in range of motion.");
  m(H,"An ankle sprain is most commonly caused by:",["Eversion injury","Inversion (rolling the foot inwards)","Hyperextension of the knee","Hip flexion"],1,"Inversion injuries usually damage the lateral ligaments.");
  m(M,"Ergonomic advice for office workers includes:",["Screens at eye level, feet supported and regular breaks","Sitting for 8 hours without moving","Looking down at the laptop all day","No chair back"],0,"Good workstation set-up prevents musculoskeletal problems.");

  /* ---------------- Dental ---------------- */
  cadre("Dental Cadre");
  m(E,"A complete adult permanent dentition has:",["20 teeth","28 teeth","32 teeth","36 teeth"],2,"Including the four third molars (wisdom teeth).");
  m(E,"The primary (milk) dentition has:",["20 teeth","24 teeth","28 teeth","32 teeth"],0,"Primary teeth are shed and replaced from about age 6.");
  m(M,"Dental caries is caused mainly by:",["Viruses","Bacteria (e.g. Streptococcus mutans) fermenting dietary sugars into acid","Cold drinks","Brushing too often"],1,"Acid dissolves tooth enamel.");
  m(M,"Fluoride helps prevent caries mainly by:",["Whitening teeth","Strengthening enamel and promoting remineralisation","Killing all bacteria","Removing tartar"],1,"Fluoride toothpaste is the most effective public-health measure.");
  m(E,"Plaque left on teeth commonly leads first to:",["Gingivitis (gum inflammation)","Broken jaw","Tooth whitening","Loss of taste"],0,"Untreated gingivitis may progress to periodontitis.");
  m(E,"The usual recommendation for tooth brushing is:",["Once a week","Twice daily for about two minutes with fluoride toothpaste","After every meal for ten minutes","Only before visiting the dentist"],1,"Spit, don't rinse, to keep the fluoride effect.");
  m(M,"In the FDI two-digit notation, tooth 11 is the:",["Lower left first molar","Upper right central incisor","Upper left canine","Lower right second premolar"],1,"First digit = quadrant (1 = upper right); second = tooth position from the midline.");
  m(M,"Fissure sealants are applied to:",["Front teeth only","The pits and fissures of molars to prevent caries","Gums","Dentures"],1,"They seal grooves where food and bacteria lodge.");
  m(M,"Scaling removes:",["Enamel","Calculus (tartar) and plaque deposits from teeth","Fillings","Gums"],1,"It is followed by polishing.");
  m(M,"Noma (cancrum oris), seen in parts of Nigeria, is strongly associated with:",["Excess sugar","Malnutrition, poor oral hygiene and debilitating illness in young children","Orthodontic braces","Fluoride"],1,"It is a rapidly destructive gangrenous disease; early treatment saves lives.");
  m(M,"Dental therapists in Nigeria are registered by the:",["Dental Therapists Registration Board of Nigeria","PCN","NMCN","MLSCN"],0,"Dentists themselves are registered by the MDCN.");
  m(M,"Dental instruments that penetrate tissue should be:",["Wiped with a cloth","Cleaned and sterilised (e.g. autoclaved) after each patient","Reused without cleaning","Soaked in water"],1,"Proper sterilisation prevents cross-infection.");
  o(M,"Arrange the permanent teeth in one quadrant from the midline outwards.",["Central incisor","Lateral incisor","Canine","First premolar","Second premolar","First molar","Second molar","Third molar"],"There are 8 teeth per quadrant in the permanent dentition.");
  x(M,"Match each instrument to its use.",[["Mouth mirror","Indirect vision and retraction"],["Dental probe/explorer","Detecting caries and calculus"],["Scaler","Removing calculus"],["Excavator","Removing soft carious dentine"]],"Basic dental examination instruments.");
  t(E,"Frequent sugary snacks between meals increase the risk of tooth decay.",true,"Frequency of sugar intake matters more than amount.");
  t(M,"The first permanent molars usually erupt at about six years of age.",true,"They erupt behind the primary molars and are often mistaken for milk teeth.");
  t(M,"Bleeding gums when brushing are normal and should be ignored.",false,"Bleeding is a sign of gingivitis and needs better oral hygiene or treatment.");
  s(E,"How many teeth are in a complete adult permanent dentition? (number only)",["32"],"Including third molars.");
  m(M,"School oral health programmes mainly aim to:",["Sell toothpaste","Educate children on oral hygiene and diet, and screen for dental problems","Extract all teeth","Replace dental clinics"],1,"Prevention starts early.");
  m(H,"A child with a swollen face and fever from a dental abscess should be:",["Sent home without treatment","Referred urgently for drainage/antibiotics as appropriate, since facial infections can spread","Given only mouthwash","Told to wait a month"],1,"Spreading dental infection can be life-threatening.");

  /* ---------------- Health Records ---------------- */
  cadre("Health Records Cadre");
  m(M,"The international system used to code diseases and causes of death is the:",["DDC","ICD (International Classification of Diseases)","ISBN","LCC"],1,"Published by WHO; ICD-11 is the latest revision.");
  m(M,"The Master Patient Index (MPI) is used to:",["Store drugs","Identify patients and locate their records using unique identifiers","Bill patients","Record staff"],1,"It prevents duplicate records.");
  m(M,"In the unit numbering system, a patient:",["Gets a new number at each visit","Keeps one number for all visits and admissions","Has no number","Shares a number with family"],1,"All records are kept together under one number.");
  m(M,"Terminal digit filing arranges records by:",["The first digits of the number","The last digits of the number","The patient's name","The date of birth"],1,"It spreads records evenly across shelves.");
  m(H,"A 50-bed ward recorded 1,200 inpatient days in a 30-day month. The bed occupancy rate is:",["60%","75%","80%","90%"],2,"1,200 ÷ (50 × 30) × 100 = 1,200 ÷ 1,500 × 100 = 80%.");
  m(M,"Average length of stay is calculated as:",["Discharges ÷ beds","Total inpatient days (of discharged patients) ÷ number of discharges","Beds ÷ days","Admissions × days"],1,"It is a key hospital efficiency indicator.");
  m(M,"The software widely used for routine health data reporting in Nigeria's NHMIS is:",["DHIS2","Koha","Excel only","Oracle HR"],0,"DHIS2 is the District Health Information System, version 2.");
  m(M,"A medical record can be released to a third party, e.g. an insurer, only:",["On request by anyone","With the patient's written consent or a legal requirement","If paid for","After a week"],1,"Confidentiality protects patients.");
  m(M,"An 'outguide' or tracer card in a filing system shows:",["The patient's diagnosis","Where a removed record has gone and when","The doctor's name only","The bill"],1,"It helps track records out of the file room.");
  m(M,"Health records officers in Nigeria are registered by the:",["Health Records Officers Registration Board of Nigeria","MDCN","NMCN","PCN"],0,"The Board regulates the profession.");
  m(M,"On a death certificate, the 'underlying cause of death' is:",["The final event, e.g. cardiac arrest","The disease or injury that started the chain of events leading to death","The place of death","The doctor's opinion of blame"],1,"It is the cause used for mortality statistics.");
  m(E,"Electronic medical records improve care mainly by:",["Making records harder to find","Providing legible, accessible and shareable patient information","Removing confidentiality","Increasing paper use"],1,"Access controls still protect privacy.");
  x(M,"Match each health statistic to its definition.",[["Crude death rate","Deaths per 1,000 population per year"],["Infant mortality rate","Deaths under 1 year per 1,000 live births"],["Bed occupancy rate","Percentage of available beds in use"],["Average length of stay","Mean number of days patients stay"]],"Standard hospital and vital statistics.");
  t(E,"Health records are legal documents and must not be altered without proper procedure.",true,"Corrections are made by dated, signed amendments.");
  t(M,"Duplicate patient records can lead to incomplete information and clinical risk.",true,"MPI management prevents duplicates.");
  t(M,"Clinical coding is optional and has no effect on health statistics.",false,"Accurate coding drives statistics, planning and reimbursement.");
  o(M,"Arrange the steps of registering a new outpatient.",["Check the MPI to confirm the patient is not already registered","Collect demographic details","Assign a unique hospital number","Create the patient folder","Direct the patient to the clinic"],"Checking first prevents duplicate records.");
  s(M,"What does 'ICD' stand for? (four words)",["international classification of diseases"],"Maintained by WHO.");
  m(M,"Records retention schedules decide:",["Staff salaries","How long different types of records are kept before archiving or destruction","Bed allocation","Drug prices"],1,"Retention follows legal and clinical needs.");
  m(M,"The best way to destroy confidential paper health records at the end of their retention period is:",["Throwing them in public bins","Secure shredding or incineration under supervision, with a record of destruction","Selling as waste paper","Leaving them outside"],1,"Destruction must protect confidentiality.");

  /* ---------------- Environmental Health ---------------- */
  cadre("Environmental Health Cadre");
  m(M,"Environmental health officers in Nigeria are registered by the:",["EHORECON (Environmental Health Officers Registration Council of Nigeria)","MDCN","NMCN","SON"],0,"EHORECON regulates the profession.");
  m(M,"The presence of coliform bacteria (especially E. coli) in drinking water indicates:",["Water is safe","Faecal contamination","Too much chlorine","High mineral content"],1,"E. coli is the standard indicator of faecal pollution.");
  m(M,"After chlorination, a free residual chlorine level of about ___ is commonly targeted at the point of delivery.",["0.2–0.5 mg/L","5–10 mg/L","0 mg/L","50 mg/L"],0,"A residual protects against recontamination in the distribution system.");
  o(M,"Arrange the waste management hierarchy from most to least preferred.",["Reduce","Reuse","Recycle","Recover (e.g. energy)","Dispose"],"Disposal is the last resort.");
  m(M,"Sharps from health facilities should be placed in:",["Plastic bags","Puncture-resistant, labelled sharps containers","Open bins","Drains"],1,"This protects waste handlers from injury and infection.");
  m(M,"A Ventilated Improved Pit (VIP) latrine reduces flies and odour mainly through:",["A vent pipe with fly screen that draws air and traps flies","Chemicals","Flushing water","A metal roof"],0,"Darkness inside and the screened vent control flies.");
  m(M,"Rodent control is a key preventive measure against:",["Lassa fever","Measles","Diabetes","Hypertension"],0,"Mastomys rats carry the Lassa virus.");
  m(M,"An abatement notice is served to:",["Reward a good premises","Require a person to stop or remedy a nuisance within a stated period","Approve a building plan","Close a market permanently without reason"],1,"Failure to comply can lead to prosecution.");
  m(M,"Mosquito breeding is best reduced by:",["Leaving water in old tyres","Eliminating stagnant water in containers, drains and tyres","Burning refuse","Planting more grass only"],1,"Source reduction is a core vector-control measure.");
  m(M,"During food premises inspection, the EHO checks:",["Only the signboard","Food storage temperatures, hygiene of handlers and premises, pest control and water supply","Owner's political party","Staff salaries"],1,"Inspection prevents food-borne disease.");
  m(M,"Overcrowding in housing increases the spread of:",["Airborne diseases such as tuberculosis","Diabetes","Sickle cell disease","Short-sightedness"],0,"Ventilation and space reduce airborne transmission.");
  m(M,"Port health services are responsible for:",["Collecting customs duties","Preventing the international spread of disease at points of entry","Running ports","Issuing passports"],1,"Under the International Health Regulations (2005).");
  x(M,"Match each Lagos agency to its environmental role.",[["LASEPA","Environmental protection and pollution control"],["LAWMA","Waste collection and disposal"],["LASWA","Waterways regulation"],["LASBCA","Building control"]],"EHOs coordinate with these agencies.");
  t(E,"Hand washing with soap at critical times reduces diarrhoeal diseases.",true,"It is one of the most cost-effective health interventions.");
  t(M,"Open burning of refuse is an environmentally sound method of waste disposal.",false,"It releases harmful smoke and toxic pollutants.");
  t(M,"Noise levels are measured in decibels (dB).",true,"Prolonged exposure above about 85 dB can damage hearing.");
  s(E,"What does 'EHO' stand for? (three words)",["environmental health officer"],"EHOs enforce public health laws.");
  m(H,"During a cholera outbreak, the priority environmental health actions are:",["Closing schools only","Ensuring safe water (chlorination), sanitation, food hygiene and health education","Spraying insecticides only","Vaccinating dogs"],1,"Cholera spreads through contaminated water and food.");
  m(M,"Medical waste should be segregated at the point of generation mainly to:",["Increase costs","Ensure safe handling and appropriate treatment of hazardous waste","Make bins colourful","Reduce staff"],1,"Mixing hazardous waste with general waste endangers people.");
  m(M,"The safe distance between a pit latrine and a well is commonly recommended to be at least:",["3 metres","30 metres","300 metres","1 metre"],1,"About 30 m (more in porous soils) reduces groundwater contamination.");

  for(var n in out)out[n].forEach(function(z){z.scope=n;});
  return out;
})();


/* ==================== inlined from cbt-bank-prof-works.js ==================== */
/* ============================================================
   PROFESSIONAL KNOWLEDGE — engineering, built environment, land
   and technical officer cadres. 20 questions per cadre.
   Shared file (browser + Apps Script).
   ============================================================ */
var SEED_PROF_WORKS=(function(){
  var out={},cur=null,C="Professional Knowledge",E="easy",M="medium",H="hard";
  function cadre(n){cur=out[n]=[];}
  function q(t,d,stem,x,ex){var o={scope:null,category:C,type:t,difficulty:d,stem:stem,explanation:ex};for(var k in x)o[k]=x[k];cur.push(o);}
  function m(d,stem,o,a,ex){q("mcq",d,stem,{options:o,answer:a},ex);}
  function t(d,stem,a,ex){q("truefalse",d,stem,{answer:a},ex);}
  function s(d,stem,acc,ex){q("shortanswer",d,stem,{accept:acc},ex);}
  function o(d,stem,items,ex){q("ordering",d,stem,{items:items},ex);}
  function x(d,stem,pairs,ex){q("matching",d,stem,{pairs:pairs.map(function(p){return {l:p[0],r:p[1]};})},ex);}

  /* ---------------- Civil Engineering ---------------- */
  cadre("Civil Engineering Cadre");
  m(M,"Engineering practitioners in Nigeria are registered and regulated by:",["NSE only","COREN (Council for the Regulation of Engineering in Nigeria)","ARCON","SON"],1,"The Nigerian Society of Engineers is the professional body; COREN is the statutory regulator.");
  m(M,"Concrete cube compressive strength is normally specified and tested at:",["3 days","7 days","28 days","90 days"],2,"7-day results give an early indication; 28 days is the design age.");
  m(M,"The slump test measures the:",["Compressive strength of hardened concrete","Workability (consistency) of fresh concrete","Moisture content of sand","Strength of steel"],1,"It checks that fresh concrete is suitable for placing.");
  m(M,"Increasing the water–cement ratio of a concrete mix generally:",["Increases strength","Reduces strength and durability","Has no effect","Makes it set faster"],1,"Excess water leaves voids as it evaporates.");
  m(M,"The California Bearing Ratio (CBR) test is used to assess the:",["Strength of subgrade and pavement materials","Workability of concrete","Tensile strength of steel","Flow in pipes"],0,"CBR values guide pavement thickness design.");
  m(M,"The Proctor compaction test determines a soil's:",["Colour","Maximum dry density and optimum moisture content","Permeability only","Shear strength only"],1,"Field compaction is checked against these values.");
  o(M,"Arrange the layers of a flexible road pavement from the bottom up.",["Subgrade","Sub-base","Base course","Binder course","Wearing course"],"Loads spread through successively stronger layers.");
  m(E,"The camber on a road surface is provided to:",["Increase speed","Drain rainwater off the carriageway","Reduce cost","Mark lanes"],1,"Poor drainage is a leading cause of road failure in Lagos.");
  m(M,"Water flows through a channel of cross-sectional area 0.5 m² at 2 m/s. The discharge Q = A × V is:",["0.25 m³/s","1.0 m³/s","2.5 m³/s","4.0 m³/s"],1,"Q = 0.5 × 2 = 1.0 m³/s.");
  m(M,"A road rises 2 m over a horizontal distance of 100 m. Its gradient is:",["0.2%","2%","20%","50%"],1,"2 ÷ 100 × 100 = 2%.");
  m(H,"The Rational Method for estimating peak storm runoff uses Q = CIA, where C is the:",["Catchment area","Runoff coefficient","Intensity of rainfall","Channel slope"],1,"C depends on surface type, e.g. high for roofs and paved areas.");
  m(M,"Concrete curing is mainly done to:",["Make concrete dry faster","Keep concrete moist so cement hydrates fully and gains strength","Colour the concrete","Reduce weight"],1,"Inadequate curing causes cracking and low strength.");
  m(M,"A nominal concrete mix of 1:2:4 refers to the proportions of:",["Water : cement : sand","Cement : sand : coarse aggregate","Sand : cement : water","Steel : cement : sand"],1,"Designed mixes are preferred for structural work.");
  x(M,"Match each test to what it measures.",[["Slump test","Workability of fresh concrete"],["Cube test","Compressive strength of concrete"],["CBR test","Bearing strength of soils"],["Sieve analysis","Particle size distribution"]],"Material testing underpins quality control.");
  t(E,"Rigid pavements are typically made of concrete slabs, while flexible pavements use bituminous layers.",true,"They distribute loads differently.");
  t(M,"Culverts are structures that carry water under roads or embankments.",true,"Undersized culverts cause flooding.");
  t(M,"Compaction of earthworks is unnecessary if the soil looks dry.",false,"Proper compaction controls settlement and strength regardless of appearance.");
  m(M,"Lagos State has a dedicated laboratory for testing construction materials to curb building collapse, known as the:",["Lagos State Materials Testing Laboratory","LASBCA Gallery","Lagos Concrete Centre","Ikeja Soil Bank"],0,"Materials testing is a key part of building-control enforcement.");
  s(M,"What test measures the workability of fresh concrete? (one word before 'test')",["slump","slump test"],"The slump test is quick and done on site.");
  m(H,"A factor of safety of 2 on a component means:",["It is designed to fail at the working load","It can carry twice the expected working load before failure","It has two supports","It is 2% stronger"],1,"Factors of safety cover uncertainties in loads and materials.");

  /* ---------------- Mechanical Engineering ---------------- */
  cadre("Mechanical Engineering Cadre");
  o(M,"Arrange the strokes of a four-stroke engine cycle in order.",["Intake (induction)","Compression","Power (expansion)","Exhaust"],"Each cycle takes two crankshaft revolutions.");
  m(M,"The first law of thermodynamics states that:",["Heat flows from cold to hot","Energy cannot be created or destroyed, only converted","Entropy always decreases","Absolute zero can be reached"],1,"It is the law of conservation of energy.");
  m(M,"A diesel engine ignites its fuel by:",["A spark plug","Heat from compressing air (compression ignition)","An open flame","Electric heating of the fuel tank"],1,"Petrol engines use spark ignition.");
  m(M,"A force of 10 kN acts on a bar with a cross-sectional area of 500 mm². The stress is:",["2 N/mm²","20 N/mm² (20 MPa)","200 N/mm²","5,000 N/mm²"],1,"Stress = 10,000 N ÷ 500 mm² = 20 N/mm².");
  m(M,"Young's modulus is the ratio of:",["Force to area","Stress to strain within the elastic range","Strain to stress","Load to deflection only"],1,"It measures a material's stiffness.");
  m(M,"A driving gear with 20 teeth meshes with a driven gear of 60 teeth. If the driver turns at 900 rpm, the driven gear turns at:",["300 rpm","600 rpm","2,700 rpm","900 rpm"],0,"Speed ratio = 60 ÷ 20 = 3, so 900 ÷ 3 = 300 rpm.");
  m(E,"One horsepower is approximately:",["100 W","746 W","1,000 W","10 kW"],1,"Engine and pump ratings often use horsepower.");
  o(M,"Arrange the main components of a vapour-compression refrigeration cycle in the order the refrigerant flows.",["Compressor","Condenser","Expansion valve","Evaporator"],"Heat is absorbed in the evaporator and rejected in the condenser.");
  m(M,"Cavitation in a centrifugal pump is caused by:",["Too much lubrication","Local pressure falling below the vapour pressure of the liquid, forming vapour bubbles that collapse","Overcooling","Excessive discharge pressure"],1,"It erodes impellers; adequate NPSH prevents it.");
  m(M,"The main function of lubrication in machinery is to:",["Increase friction","Reduce friction and wear, and carry away heat","Add weight","Change colour"],1,"Correct lubricant and intervals extend equipment life.");
  m(M,"A boiler safety valve is designed to:",["Increase pressure","Release steam automatically if pressure exceeds a set limit","Feed water","Measure temperature"],1,"It prevents boiler explosions; it must be tested regularly.");
  m(M,"Mean Time Between Failures (MTBF) is a measure of:",["Cost","Reliability of repairable equipment","Fuel efficiency","Weight"],1,"Higher MTBF means fewer breakdowns.");
  x(M,"Match each welding process to its description.",[["MIG","Continuous wire electrode with shielding gas"],["TIG","Non-consumable tungsten electrode"],["Manual metal arc (stick)","Flux-coated consumable electrode"],["Oxy-acetylene","Gas flame for welding and cutting"]],"Process choice depends on material and application.");
  t(E,"Preventive maintenance is carried out on a schedule to reduce the likelihood of breakdowns.",true,"It is usually cheaper than emergency repairs.");
  t(M,"Machine efficiency can be greater than 100% with good design.",false,"Some energy is always lost; efficiency is always below 100%.");
  t(M,"Torque multiplied by angular speed gives mechanical power.",true,"Power P = torque T × angular speed ω (in rad/s).");
  m(M,"A machine takes 5 kW input and delivers 4 kW useful output. Its efficiency is:",["125%","80%","20%","40%"],1,"4 ÷ 5 × 100 = 80%.");
  s(E,"What is the SI unit of power?",["watt","watts","w"],"1 W = 1 joule per second.");
  m(M,"Lifts (elevators) in public buildings should be:",["Maintained only when they break","Inspected and maintained regularly by competent persons, with records kept","Used without inspection","Maintained by any staff member"],1,"Lift failures can cause serious injury.");
  m(H,"Before working on a machine, lockout/tagout (LOTO) ensures that:",["The machine runs faster","Energy sources are isolated and locked so the machine cannot start unexpectedly","Tools are tagged with prices","The machine is painted"],1,"LOTO prevents serious injuries during maintenance.");

  /* ---------------- Electrical Engineering ---------------- */
  cadre("Electrical Engineering Cadre");
  m(E,"Ohm's law states that:",["V = I × R","P = I ÷ R","R = V × I","I = V × R"],0,"Voltage = current × resistance.");
  m(M,"A 230 V supply drives a current of 5 A through a heater. Its power is:",["46 W","235 W","1,150 W","2,300 W"],2,"P = V × I = 230 × 5 = 1,150 W.");
  m(M,"A 2 kW air conditioner runs for 5 hours. The energy consumed is:",["2.5 kWh","7 kWh","10 kWh","20 kWh"],2,"2 kW × 5 h = 10 kWh.");
  m(M,"The standard single-phase supply voltage and frequency in Nigeria is:",["110 V, 60 Hz","230 V, 50 Hz","400 V, 60 Hz","120 V, 50 Hz"],1,"Three-phase line voltage is about 400–415 V.");
  m(M,"Two 6 Ω resistors connected in parallel have a combined resistance of:",["12 Ω","6 Ω","3 Ω","36 Ω"],2,"1/R = 1/6 + 1/6 = 1/3, so R = 3 Ω.");
  m(M,"The main purpose of earthing an electrical installation is to:",["Save energy","Provide a safe path for fault current so protective devices operate and shock risk is reduced","Increase voltage","Reduce cable size"],1,"Good earthing is fundamental to electrical safety.");
  m(M,"An RCD (residual current device) mainly protects against:",["Overloads only","Electric shock from earth leakage currents","Lightning","Low voltage"],1,"It trips when current leaks to earth, e.g. through a person.");
  x(M,"Match each cable core colour (IEC harmonised) to its function.",[["Brown","Line (live)"],["Blue","Neutral"],["Green/yellow","Protective earth"],["Grey or black (three-phase)","Other line conductors"]],"Correct identification prevents dangerous errors.");
  m(M,"A transformer works on the principle of:",["Static electricity","Electromagnetic (mutual) induction","Chemical reaction","Thermal expansion"],1,"It works only with alternating current.");
  m(M,"Power factor correction capacitors are installed mainly to:",["Increase lighting","Reduce reactive power and improve power factor, lowering losses and demand charges","Stop lightning","Generate DC"],1,"Inductive loads like motors lower power factor.");
  m(H,"The Electricity Act 2023 is significant for states such as Lagos because it:",["Abolished electricity regulation","Allows states to make laws and regulate electricity markets within their territory","Banned private generation","Nationalised DisCos"],1,"States can now establish their own electricity markets and regulators.");
  m(M,"The federal agency responsible for inspecting and certifying electrical installations and enforcing technical standards is:",["NEMSA (Nigerian Electricity Management Services Agency)","NAFDAC","NCC","NNRA"],0,"NEMSA certifies electrical installations and materials.");
  m(M,"In a solar PV system, the inverter:",["Stores energy","Converts DC from panels/batteries to AC for appliances","Generates sunlight","Measures temperature"],1,"Charge controllers regulate battery charging.");
  m(M,"An insulation resistance tester ('megger') is used to:",["Measure current","Check the insulation quality of cables and equipment","Measure light","Test fuses only"],1,"Low insulation resistance indicates deterioration or faults.");
  o(M,"Arrange the steps of safe isolation before working on a circuit.",["Identify the circuit","Switch off and isolate the supply","Lock off and tag the isolator","Prove the tester works on a known live source","Test the circuit is dead","Re-prove the tester"],"'Prove–test–prove' confirms the circuit is truly dead.");
  t(E,"Switches should be connected in the line (live) conductor, not the neutral.",true,"Otherwise the appliance stays live when switched off.");
  t(M,"A fuse or MCB protects mainly against overcurrent from overloads and short circuits.",true,"RCDs protect against earth leakage.");
  t(M,"Transformers work equally well on direct current.",false,"Steady DC produces no changing flux, so no voltage is induced.");
  s(M,"What does 'kWh' stand for? (two words)",["kilowatt hour","kilowatt-hour","kilowatt hours"],"The kWh is the unit used for electricity billing.");
  m(H,"A 3-phase motor draws 10 A at 400 V (line) with a power factor of 0.8. Its input power is about:",["3.2 kW","5.5 kW","6.9 kW","4.0 kW"],1,"P = √3 × V × I × pf = 1.732 × 400 × 10 × 0.8 ≈ 5,542 W ≈ 5.5 kW.");

  /* ---------------- Structural Engineering ---------------- */
  cadre("Structural Engineering Cadre");
  m(M,"The self-weight of a structure and permanent fixtures is called:",["Live (imposed) load","Dead (permanent) load","Wind load","Dynamic load"],1,"Live loads come from occupancy and movable items.");
  m(H,"A simply supported beam of span 6 m carries a uniformly distributed load of 10 kN/m. The maximum bending moment (wL²/8) is:",["30 kNm","45 kNm","60 kNm","90 kNm"],1,"10 × 6² ÷ 8 = 360 ÷ 8 = 45 kNm.");
  m(H,"A simply supported beam of span 4 m carries a point load of 20 kN at midspan. The maximum bending moment (PL/4) is:",["10 kNm","20 kNm","40 kNm","80 kNm"],1,"20 × 4 ÷ 4 = 20 kNm.");
  m(M,"In a simply supported reinforced concrete beam under gravity load, the main tension reinforcement is placed:",["At the top","At the bottom","At mid-depth","Only at the supports"],1,"Sagging puts the bottom fibres in tension.");
  m(E,"Concrete is:",["Strong in tension, weak in compression","Strong in compression, weak in tension","Equally strong in both","Weak in both"],1,"Steel reinforcement carries the tension.");
  m(M,"Concrete cover to reinforcement is provided mainly for:",["Appearance","Corrosion protection, fire resistance and bond","Reducing weight","Speed of construction"],1,"Inadequate cover causes rusting and spalling.");
  x(M,"Match each foundation type to its typical use.",[["Strip foundation","Load-bearing walls"],["Pad foundation","Individual columns"],["Raft foundation","Weak soils or heavy loads over the whole plan area"],["Pile foundation","Transferring loads to deep firm strata"]],"Foundation choice depends on soil and loads.");
  m(M,"Because much of Lagos has soft, marshy soils, multi-storey buildings often require:",["No foundations","Deep foundations such as piles after proper soil investigation","Shallow pads always","Timber foundations"],1,"Geotechnical investigation determines the right foundation.");
  m(M,"The rebound (Schmidt) hammer test is a:",["Destructive test on steel","Non-destructive test estimating concrete surface hardness/strength","Soil test","Water test"],1,"Results are indicative and should be correlated with cores.");
  m(M,"A common cause of building collapse in Lagos is:",["Using approved designs","Substandard materials, poor supervision and unauthorised additional floors","Too many inspections","Excessive reinforcement"],1,"Enforcement of building regulations targets these causes.");
  m(M,"The moment of a 15 kN force acting at 2 m from a pivot is:",["7.5 kNm","13 kNm","17 kNm","30 kNm"],3,"Moment = force × perpendicular distance = 15 × 2 = 30 kNm.");
  m(M,"Slender columns are prone to failure by:",["Crushing only","Buckling","Shear only","Corrosion only"],1,"Slenderness reduces load capacity.");
  o(M,"Arrange the stages of delivering a building structure in order.",["Site and soil investigation","Structural analysis and design","Design checking and approval","Construction","Supervision and testing","Certification of completion"],"Each stage reduces the risk of failure.");
  t(E,"Imposed loads on office floors are generally higher than on residential floors.",true,"Codes specify higher imposed loads for offices and assembly areas.");
  t(M,"A structural integrity test may be ordered for an existing building showing distress before it is reoccupied.",true,"Tests guide decisions on repair or demolition.");
  t(M,"Adding extra floors to an existing building is safe without structural assessment if the columns look strong.",false,"Additional floors require structural assessment and approval.");
  s(M,"What is the name of the load from people, furniture and movable items? (two words, e.g. '____ load')",["live load","imposed load","live","imposed"],"Also called imposed load.");
  m(H,"Ultrasonic pulse velocity testing of concrete mainly indicates:",["Colour","Uniformity and the presence of voids or cracks","Water content only","Steel grade"],1,"Low velocities suggest poor-quality or cracked concrete.");
  m(M,"Deflection limits in design are set mainly to:",["Increase cost","Prevent excessive movement that damages finishes or affects use","Make beams heavier","Satisfy architects only"],1,"Serviceability limits complement strength checks.");
  m(M,"Common structural design codes used in Nigeria include:",["BS 8110 / Eurocodes","US Highway Code","Medical codes","Tax codes"],0,"Nigeria also has the National Building Code.");

  /* ---------------- Architecture ---------------- */
  cadre("Architecture Cadre");
  m(M,"Architects in Nigeria are registered and regulated by:",["COREN","ARCON (Architects Registration Council of Nigeria)","TOPREC","QSRBN"],1,"The Nigerian Institute of Architects is the professional body.");
  o(M,"Arrange the typical stages of the architectural design process.",["Client brief","Concept / sketch design","Design development","Working (construction) drawings","Tender documents","Construction and contract administration"],"Each stage builds on the approved previous stage.");
  m(E,"On a drawing at a scale of 1:100, 1 cm represents:",["1 cm","10 cm","1 m","10 m"],2,"1 cm × 100 = 100 cm = 1 m.");
  m(M,"A wall 12 m long is drawn at 1:50. Its length on the drawing is:",["12 cm","24 cm","60 cm","2.4 cm"],1,"12,000 mm ÷ 50 = 240 mm = 24 cm.");
  x(E,"Match each drawing type to what it shows.",[["Plan","Horizontal layout seen from above"],["Elevation","External face of a building"],["Section","A vertical cut through the building"],["Site plan","Building position on the plot and its surroundings"]],"These drawings together describe a building.");
  m(M,"For passive cooling in Lagos's hot-humid climate, buildings are best oriented with:",["Long facades facing east and west","Long facades facing north and south, with shading and cross-ventilation","No windows","Flat black roofs"],1,"This reduces low-angle east/west sun and harnesses breezes.");
  m(M,"Planning permits for development in Lagos State are issued by:",["LASPPPA (Lagos State Physical Planning Permit Authority)","LAWMA","LASTMA","LASRRA"],0,"LASBCA then controls construction and building safety.");
  m(M,"In Lagos, a building must not be occupied until it has been issued a:",["C of O","Certificate of Completion and Fitness for Habitation","Tax receipt","Building plan only"],1,"Issued after inspection of the completed building.");
  m(M,"A wheelchair ramp is commonly designed with a maximum gradient of about:",["1:4","1:12","1:2","1:1"],1,"Gentle gradients make buildings accessible.");
  m(M,"Vitruvius described good architecture as having:",["Speed, cost and size","Firmness (firmitas), commodity/usefulness (utilitas) and delight (venustas)","Height, colour and light","Steel, glass and concrete"],1,"A classic definition still taught today.");
  m(M,"BIM stands for:",["Building Information Modelling","Basic Interior Measurement","Building Inspection Manual","Brick Installation Method"],0,"BIM creates a shared digital model of a building.");
  m(M,"The modernist dictum 'form follows function' is associated with:",["Louis Sullivan","Frank Lloyd Wright only","Vitruvius","Michelangelo"],0,"Sullivan coined the phrase in 1896.");
  m(M,"Setbacks in building regulations mainly ensure:",["Larger buildings","Light, ventilation, privacy, access and fire safety between buildings and roads","Lower costs","Taller fences"],1,"Encroachment on setbacks is a common contravention.");
  t(E,"Fire escape routes should be clearly marked and kept free of obstruction.",true,"Escape routes save lives in emergencies.");
  t(M,"Cross-ventilation requires openings on opposite or adjacent walls to let air flow through a space.",true,"It is a key passive cooling strategy.");
  t(M,"An architect may start construction once the client approves the design, without a planning permit.",false,"A planning permit is legally required before construction.");
  s(E,"What does BIM stand for? (three words)",["building information modelling","building information modeling"],"BIM supports coordination and clash detection.");
  m(H,"A building with deep overhangs, light-coloured roofing and high ceilings is primarily designed to:",["Increase heating","Reduce heat gain and improve thermal comfort","Look traditional only","Reduce daylight entirely"],1,"Common bioclimatic strategies for the tropics.");
  m(M,"Working drawings differ from sketch designs mainly because they:",["Are artistic impressions","Give detailed dimensions, specifications and construction details for building","Are for marketing","Are hand-drawn"],1,"Contractors build from working drawings.");
  m(M,"A design brief is:",["The final drawing","A statement of the client's requirements, budget and constraints","A planning permit","A tender"],1,"Good briefs prevent costly redesign.");

  /* ---------------- Town Planning ---------------- */
  cadre("Town Planning Cadre");
  m(M,"Town planners in Nigeria are registered by:",["COREN","TOPREC (Town Planners Registration Council of Nigeria)","ESVARBON","SURCON"],1,"The Nigerian Institute of Town Planners is the professional body.");
  m(M,"Under the Land Use Act 1978, land in each state (urban areas) is vested in the:",["Traditional rulers","Governor, in trust for the people","Federal Government","Local communities"],1,"The Governor grants statutory rights of occupancy.");
  m(M,"The document evidencing a statutory right of occupancy is the:",["Survey plan","Certificate of Occupancy (C of O)","Building plan","Tax clearance"],1,"Consent is needed to assign or mortgage it.");
  m(M,"A plot of 1,000 m² has a building with a total floor area of 2,500 m². The floor area ratio (plot ratio) is:",["0.4","1.5","2.5","25"],2,"FAR = total floor area ÷ plot area = 2,500 ÷ 1,000 = 2.5.");
  m(M,"A building footprint of 600 m² on a 1,000 m² plot gives a plot coverage of:",["6%","40%","60%","166%"],2,"600 ÷ 1,000 × 100 = 60%.");
  m(M,"Zoning in urban planning mainly aims to:",["Raise taxes","Separate or regulate land uses to reduce conflict and guide orderly development","Increase traffic","Ban development"],1,"E.g. separating heavy industry from housing.");
  m(M,"The 'Garden City' concept was proposed by:",["Le Corbusier","Ebenezer Howard","Clarence Perry","Patrick Geddes"],1,"Howard's 1898 idea combined town and country.");
  m(M,"The 'Neighbourhood Unit' concept, with a primary school at its centre, was developed by:",["Clarence Perry","Ebenezer Howard","Robert Moses","Jane Jacobs"],0,"Perry proposed it in the 1920s.");
  m(M,"The main Lagos law governing physical planning and development control is the:",["Land Use Act only","Lagos State Urban and Regional Planning and Development Law (as amended)","Tenancy Law","Environmental Sanitation Law"],1,"It establishes the planning agencies and permit system.");
  m(M,"A 'Model City Plan' or master plan sets out:",["Building colours","Long-term land-use allocation, infrastructure and development guidelines for an area","Tax rates","Street names only"],1,"Lagos has model city plans for several districts.");
  m(M,"GIS in planning is used to:",["Write laws","Capture, analyse and map spatial data for decisions","Collect rent","Build roads"],1,"GIS overlays land use, infrastructure and population data.");
  m(M,"An Environmental Impact Assessment (EIA) is required to:",["Approve all small houses","Identify and mitigate the environmental effects of major projects before approval","Collect taxes","Name streets"],1,"Under the EIA Act, certain projects require assessment.");
  x(M,"Match each planning term to its meaning.",[["Setback","Minimum distance between a building and the plot boundary or road"],["Right of way","Land reserved for roads and utilities"],["Density","Number of people or dwellings per unit area"],["Contravention","Development in breach of planning regulations"]],"Core development-control vocabulary.");
  o(M,"Arrange the stages of the planning process.",["Survey and data collection","Analysis","Formulation of plan proposals","Plan approval","Implementation","Monitoring and review"],"Plans are reviewed as conditions change.");
  t(E,"Urban renewal involves redeveloping deteriorated areas to improve living conditions.",true,"Approaches range from upgrading to redevelopment.");
  t(M,"Building on drainage channels and setbacks contributes to flooding in Lagos.",true,"Enforcement against such contraventions is a planning priority.");
  t(M,"A planning permit is not required for adding new floors to an existing building.",false,"Material alterations require permits.");
  s(M,"What is the ratio of a building's total floor area to its plot area called? (accept 'floor area ratio' or 'plot ratio')",["floor area ratio","plot ratio","far"],"It controls development intensity.");
  m(H,"Slum upgrading, as opposed to clearance, typically:",["Evicts residents","Improves infrastructure and services in place while securing residents' tenure","Ignores the community","Builds luxury estates"],1,"It reduces displacement and preserves livelihoods.");
  m(M,"A contravention notice in development control is served to:",["Approve a plan","Inform a developer of a breach and require them to stop or regularise within a period","Collect rent","Reward compliance"],1,"Further notices and enforcement follow non-compliance.");

  /* ---------------- Quantity Surveying ---------------- */
  cadre("Quantity Surveying Cadre");
  m(M,"Quantity surveyors in Nigeria are registered by:",["QSRBN (Quantity Surveyors Registration Board of Nigeria)","COREN","ARCON","ESVARBON"],0,"The NIQS is the professional body.");
  m(M,"A Bill of Quantities is:",["A drawing","A document itemising quantities and descriptions of work, priced by tenderers","A building permit","A soil report"],1,"It gives a common basis for competitive tendering.");
  x(M,"Match each work item to its usual unit of measurement.",[["Concrete in foundations","m³"],["Blockwork walls","m²"],["Steel reinforcement","kg or tonnes"],["Skirting","linear metres (m)"]],"Standard methods of measurement specify units.");
  m(M,"A Provisional Sum in a BOQ is:",["A fixed price for known work","An allowance for work that cannot be fully defined at tender stage","The contractor's profit","Retention money"],1,"It is adjusted when the work is defined.");
  m(M,"A Prime Cost (PC) sum is:",["The total project cost","An allowance for work or materials from a nominated supplier or subcontractor","A penalty","Overheads"],1,"The contractor adds profit and attendance.");
  m(M,"Retention money is:",["The contractor's profit","A percentage withheld from interim payments as security for defects","Tax","Advance payment"],1,"Half is often released at practical completion and half after the defects period.");
  m(M,"An interim valuation of ₦20m has 5% retention. The amount retained is:",["₦100,000","₦1,000,000","₦2,000,000","₦500,000"],1,"5% of ₦20m = ₦1m.");
  m(M,"A wall 10 m long and 3 m high has a door opening of 2 m². The net area of blockwork is:",["30 m²","28 m²","32 m²","26 m²"],1,"10 × 3 = 30 m²; minus 2 m² = 28 m².");
  m(M,"'Preliminaries' in a BOQ cover:",["Foundations only","General items such as site set-up, insurances, supervision and temporary works","Finishes","Electrical works"],1,"They are costs not tied to specific work items.");
  m(M,"Liquidated damages are:",["Extra payment for early completion","A pre-agreed amount payable by the contractor for each period of delay","Damage to materials","Insurance claims"],1,"They must be a genuine pre-estimate of loss.");
  m(M,"A variation in a construction contract is:",["Fraud","A change to the scope or specification of the works instructed under the contract","A price increase claim","Retention"],1,"Variations are valued using contract rates where applicable.");
  m(M,"When evaluating tenders, the quantity surveyor checks priced BOQs for:",["Fonts","Arithmetic errors and unbalanced or unrealistic rates","Logo colours","Number of pages"],1,"Errors are handled under the tender rules.");
  m(H,"Life-cycle costing considers:",["Only construction cost","All costs over a building's life: construction, operation, maintenance and disposal","Only furniture","Only design fees"],1,"Cheaper initial choices may cost more over time.");
  o(M,"Arrange the QS's cost-management stages in order.",["Preliminary estimate","Cost plan","Bill of quantities and tender","Interim valuations during construction","Final account"],"Cost control runs from inception to completion.");
  t(E,"An elemental cost plan breaks down the estimated cost by building elements such as substructure, frame and roof.",true,"It supports cost control during design.");
  t(M,"The final account is prepared before construction starts.",false,"The final account is agreed at the end of the contract.");
  t(M,"A fluctuation clause allows contract sums to be adjusted for specified changes in costs such as materials or labour.",true,"It shares inflation risk between parties.");
  s(M,"What document itemises quantities of work for contractors to price? (three words)",["bill of quantities","boq","bills of quantities"],"Abbreviated BOQ.");
  m(M,"A contingency sum in an estimate is:",["Profit","An allowance for unforeseen costs","Retention","VAT"],1,"It manages risk.");
  m(H,"The total of interim certificates is ₦80m gross with 5% retention, and ₦60m has already been paid. The amount due on the next certificate is:",["₦16m","₦20m","₦17m","₦4m"],0,"Net of retention = 80 × 0.95 = ₦76m; less ₦60m paid = ₦16m.");

  /* ---------------- Land Surveying ---------------- */
  cadre("Land Surveying Cadre");
  m(M,"Surveyors in Nigeria are registered by:",["SURCON (Surveyors Council of Nigeria)","COREN","TOPREC","ESVARBON"],0,"Only registered surveyors may sign survey plans.");
  m(M,"Survey plans in Lagos State must be lodged and approved by the:",["Office of the Surveyor-General of Lagos State","LASTMA","LASBCA","LAWMA"],0,"Approval guards against encroachment and fraudulent plans.");
  m(E,"A whole-circle bearing is measured:",["Anticlockwise from East","Clockwise from North, from 0° to 360°","From South only","In metres"],1,"Bearings describe directions of survey lines.");
  m(M,"The back bearing of a line with a forward bearing of 060° is:",["120°","240°","300°","060°"],1,"Back bearing = forward bearing ± 180° = 240°.");
  m(M,"In levelling, a backsight of 1.500 m and a foresight of 2.300 m indicate a:",["Rise of 0.800 m","Fall of 0.800 m","Rise of 3.800 m","No change"],1,"BS − FS = 1.5 − 2.3 = −0.8 m: a fall.");
  m(M,"A benchmark in surveying is:",["A seat","A fixed point of known height (reduced level)","A plot boundary","A road sign"],1,"Levels are referenced to benchmarks.");
  m(M,"A theodolite is mainly used to measure:",["Distance only","Horizontal and vertical angles","Temperature","Soil strength"],1,"A total station combines angle and electronic distance measurement.");
  m(E,"Contour lines that are close together on a map indicate:",["Flat ground","Steep slopes","Water","Roads"],1,"Widely spaced contours show gentle slopes.");
  m(M,"A rectangular plot measuring 30 m by 60 m has an area of:",["180 m²","1,800 m² (0.18 ha)","18,000 m²","900 m²"],1,"1 hectare = 10,000 m².");
  m(M,"The geodetic datum traditionally used for Nigerian mapping is the:",["WGS 84 only","Minna datum","Lagos datum","Kano datum"],1,"Coordinates are increasingly referenced to WGS84 via GNSS.");
  m(M,"GNSS (e.g. GPS) surveying determines positions using:",["Magnets","Signals from satellites","Sound waves","Levels"],1,"High-accuracy surveys use differential/RTK techniques.");
  m(M,"Survey beacons (pillars) on a parcel boundary should:",["Be moved freely","Remain undisturbed; their removal is an offence","Be painted only","Be replaced by fences"],1,"Beacons define the legal boundary.");
  x(M,"Match each type of survey to its purpose.",[["Cadastral survey","Defining property boundaries"],["Topographic survey","Mapping ground features and relief"],["Hydrographic survey","Mapping water bodies and depths"],["Engineering survey","Setting out and controlling construction"]],"Different surveys serve different purposes.");
  o(M,"Arrange the main stages of a cadastral survey.",["Research existing records and plans","Reconnaissance of the site","Field measurement and beaconing","Computation and plotting","Plan preparation and signing","Lodgement for approval"],"Approval completes the process.");
  t(E,"Traverse closure checks show whether measured angles and distances form a consistent loop.",true,"Misclosures beyond tolerance require re-measurement.");
  t(M,"A survey plan signed by an unregistered person is valid if accurate.",false,"Only registered surveyors may certify survey plans.");
  t(M,"Reduced levels show heights relative to a datum.",true,"They are computed from staff readings and benchmarks.");
  s(M,"A line has a forward bearing of 135°. What is its back bearing in degrees? (number only)",["315"],"135 + 180 = 315°.");
  m(H,"In levelling by the rise-and-fall method, the arithmetic check is:",["ΣBS − ΣFS = ΣRise − ΣFall = last RL − first RL","ΣBS = ΣFS","ΣRise = ΣFall always","None"],0,"All three differences must agree.");
  m(M,"On a map at 1:2,000, a distance of 5 cm represents:",["10 m","100 m","1,000 m","50 m"],1,"5 cm × 2,000 = 10,000 cm = 100 m.");

  /* ---------------- Estate Management ---------------- */
  cadre("Estate Management Cadre");
  m(M,"Estate surveyors and valuers in Nigeria are registered by:",["ESVARBON","SURCON","TOPREC","COREN"],0,"The Estate Surveyors and Valuers Registration Board of Nigeria.");
  x(M,"Match each valuation method to its typical use.",[["Comparative method","Properties with good market evidence, e.g. houses"],["Investment method","Income-producing properties"],["Residual method","Development land"],["Cost (contractor's) method","Special properties rarely sold, e.g. schools"]],"The method depends on the property type and evidence.");
  m(H,"A property produces a net rent of ₦2m a year. Using a yield of 10%, the capital value (YP in perpetuity = 100 ÷ yield) is:",["₦2m","₦10m","₦20m","₦200m"],2,"YP = 100 ÷ 10 = 10; value = 2m × 10 = ₦20m.");
  m(M,"Under the Land Use Act, assignment or mortgage of a statutory right of occupancy requires the:",["Neighbour's approval","Governor's consent","Police permit","Bank's approval only"],1,"Section 22; transactions without consent are void.");
  m(M,"A statutory right of occupancy is commonly granted for a term of up to:",["10 years","25 years","99 years","Forever"],2,"Usually 99 years, renewable.");
  m(M,"Under the Lagos State Tenancy Law 2011, a yearly tenant is entitled to a notice to quit of:",["One week","One month","Three months","Six months"],3,"Monthly tenants get one month; yearly tenants six months, unless agreed otherwise.");
  m(M,"Under the Lagos Tenancy Law, it is unlawful for a landlord to demand from a new yearly tenant rent in advance of more than:",["One month","Six months","One year","Five years"],2,"This curbs the practice of demanding two or three years' rent.");
  m(M,"'Highest and best use' in valuation means:",["The most expensive building","The reasonably probable, legal use that produces the highest value","The current use only","The oldest use"],1,"Valuers assess what use maximises value.");
  m(M,"Property management mainly involves:",["Only collecting rent","Letting, rent collection, maintenance, tenant relations and record keeping on the owner's behalf","Building new estates only","Valuation only"],1,"Good management preserves value and income.");
  m(M,"A service charge in a multi-tenanted building covers:",["Rent","Costs of common services such as security, cleaning and maintenance of shared areas","Taxes only","Owner's profit"],1,"It should be transparent and accounted for.");
  m(M,"Compensation for land compulsorily acquired under the Land Use Act is generally payable for:",["The land itself at market value","Unexhausted improvements (buildings, crops) rather than the bare land","Nothing","Future profits"],1,"Section 29 of the Act.");
  m(M,"Facility management focuses on:",["Selling properties","Operating and maintaining buildings and services to support occupiers efficiently","Designing buildings","Survey plans"],1,"It covers maintenance, energy, safety and services.");
  o(M,"Arrange the steps of a valuation assignment.",["Receive and agree instructions","Inspect the property","Gather market evidence","Analyse and apply valuation methods","Prepare and deliver the valuation report"],"A structured process supports defensible values.");
  t(E,"A lease gives the tenant exclusive possession of property for a defined term in return for rent.",true,"The landlord retains the reversion.");
  t(M,"A valuer may value a property in which they have an undisclosed financial interest.",false,"Conflicts of interest must be disclosed or the instruction declined.");
  t(M,"Depreciation reduces the value of buildings over time due to physical deterioration and obsolescence.",true,"Land itself does not usually depreciate.");
  s(M,"Net rent is ₦3m a year and the yield is 12%. What is the Years' Purchase in perpetuity? (number, 2 decimal places, e.g. 8.33)",["8.33","8.3","8.333"],"YP = 100 ÷ 12 ≈ 8.33.");
  m(M,"Ground rent is paid by the holder of a statutory right of occupancy to:",["The developer","The State Government","The tenant","The bank"],1,"It is a condition of the right of occupancy.");
  m(H,"In the residual method, the residual value of development land is:",["Gross development value plus costs","Gross development value minus development costs and developer's profit","Rent multiplied by YP only","Building cost only"],1,"What remains is the value of the land.");
  m(M,"A dilapidations schedule lists:",["Rent arrears","Repairs a tenant must carry out under the lease, usually at its end","New tenants","Valuation figures"],1,"Used to settle repairing obligations.");

  /* ---------------- Technical Officer (Civil) ---------------- */
  cadre("Technical Officer (Civil) Cadre");
  m(E,"The '3-4-5' method is used on site to:",["Mix concrete","Set out a right angle","Test soil","Measure rainfall"],1,"A triangle with sides 3, 4 and 5 units has a right angle.");
  m(E,"A common mortar mix for sandcrete blockwork is about:",["1:1","1:6 (cement : sand)","1:20","3:1"],1,"Richer mixes are used where higher strength is required.");
  m(M,"A damp-proof course (DPC) in a wall prevents:",["Fire","Moisture rising from the ground into the wall","Termites only","Cracks"],1,"It is laid above ground level.");
  m(E,"Standard sandcrete blocks for external load-bearing walls in Nigeria are commonly:",["100 mm (4\")","150 mm (6\")","225 mm (9\")","50 mm (2\")"],2,"150 mm blocks are common for internal partitions.");
  m(M,"Freshly placed concrete slabs should be cured for at least about:",["1 hour","7 days","1 year","Not at all"],1,"Longer curing improves strength and durability.");
  m(M,"A lintel is placed:",["Under the foundation","Over a door or window opening to carry the wall above","On the roof","Inside a column"],1,"Lintels transfer loads around openings.");
  m(E,"A site diary records:",["Workers' personal lives","Daily site activities, weather, labour, materials, instructions and incidents","Only visitors","Only payments"],1,"It is valuable evidence in disputes.");
  m(M,"Before concrete is poured, the technical officer should check:",["Only the weather","Formwork, reinforcement (size, spacing, cover) and cleanliness","The contractor's car","Paint colour"],1,"Pre-pour inspection prevents defects.");
  m(M,"On a drawing at 1:100, a room measures 4 cm by 3 cm. Its actual size is:",["4 m × 3 m","40 m × 30 m","0.4 m × 0.3 m","400 m × 300 m"],0,"Each cm represents 1 m.");
  m(E,"A spirit level is used to check that surfaces are:",["Strong","Level or plumb","Wet","Painted"],1,"Accurate levels prevent defects.");
  m(M,"Formwork for a suspended slab should not be removed until:",["The next morning regardless","The concrete has gained enough strength, as specified or approved","It is painted","The contractor wishes"],1,"Early striking can cause collapse.");
  x(E,"Match each material to its use.",[["Cement","Binder in concrete and mortar"],["Sharp sand","Fine aggregate"],["Granite chippings","Coarse aggregate"],["Reinforcement bars","Carry tension in concrete"]],"Know the basic construction materials.");
  t(E,"Workers on site should wear PPE such as helmets and safety boots.",true,"PPE reduces injuries.");
  t(M,"Adding extra water to stiff concrete on site to make it easier to place is good practice.",false,"Extra water reduces strength.");
  t(M,"Concrete should be placed and compacted (e.g. vibrated) to remove trapped air.",true,"Voids weaken concrete.");
  o(E,"Arrange the basic stages of building a house.",["Setting out","Excavation and foundation","Blockwork (superstructure)","Roofing","Finishes"],"Each stage depends on the previous one.");
  s(E,"What right-angle method uses a triangle with sides of 3, 4 and 5 units? (accept '3-4-5')",["3-4-5","345","3 4 5","three four five"],"Based on Pythagoras' theorem.");
  m(M,"A batch of blocks fails a strength test. The technical officer should:",["Accept them","Reject them and report to the engineer","Use them for upper floors","Hide the result"],1,"Substandard materials contribute to building collapse.");
  m(M,"The volume of concrete in a slab 5 m × 4 m × 0.15 m is:",["3 m³","20 m³","0.3 m³","30 m³"],0,"5 × 4 × 0.15 = 3 m³.");
  m(E,"A water level (transparent hose filled with water) is used to:",["Mix mortar","Transfer levels between points","Cut blocks","Cure concrete"],1,"Water finds its own level at both ends.");

  /* ---------------- Technical Officer (Mechanical) ---------------- */
  cadre("Technical Officer (Mechanical) Cadre");
  m(M,"A metric outside micrometer typically reads to:",["1 mm","0.1 mm","0.01 mm","1 cm"],2,"Vernier calipers usually read to 0.02 or 0.05 mm.");
  m(E,"Engine oil in a generator should be changed:",["Never","According to the manufacturer's service interval (running hours)","Only when the engine stops","Every ten years"],1,"Old oil loses its lubricating properties.");
  m(M,"Acetylene cylinders should be stored and used:",["Lying down","Upright, secured and away from heat","Near oxygen without separation","In closed cupboards with no ventilation"],1,"Lying acetylene cylinders can release acetone dangerously.");
  m(E,"A clogged air filter on an engine causes:",["Better performance","Reduced power, higher fuel use and black smoke","Lower temperature","Nothing"],1,"Engines need clean air for combustion.");
  m(M,"A V-belt that is too loose will:",["Run cooler","Slip, causing loss of power and wear","Increase speed","Never wear"],1,"Correct belt tension is checked during maintenance.");
  m(M,"A split-unit air conditioner blowing warm air may have:",["Too much electricity","Low refrigerant, a dirty condenser or a faulty compressor","Too much cooling","Clean filters"],1,"Diagnose before topping up refrigerant.");
  m(E,"Grease is applied to bearings to:",["Make them noisy","Reduce friction and protect against wear and corrosion","Increase weight","Clean them"],1,"Over-greasing can also cause overheating.");
  m(M,"Before servicing a machine, the technician must:",["Work on it running","Isolate and lock off the power source","Ask a passer-by","Remove guards while it runs"],1,"Lockout/tagout prevents accidental start-up.");
  m(M,"A lathe is mainly used for:",["Welding","Turning cylindrical parts by rotating the workpiece against a cutting tool","Painting","Bending sheet metal"],1,"Common operations include facing, turning and threading.");
  m(M,"A torque wrench is used to:",["Cut bolts","Tighten fasteners to a specified torque","Measure length","Drill holes"],1,"Correct torque prevents loosening or failure.");
  m(M,"Cavitation noise in a water pump often means:",["Normal operation","Inadequate suction (e.g. blocked suction line or low water level)","Too much oil","New impeller"],1,"Check suction conditions to prevent impeller damage.");
  x(E,"Match each tool to its use.",[["Vernier caliper","Precise internal and external measurement"],["Feeler gauge","Measuring small gaps"],["Spanner","Turning nuts and bolts"],["Hacksaw","Cutting metal"]],"Workshop tools and their uses.");
  t(E,"A maintenance log for each machine helps track servicing and breakdown history.",true,"Records support planned maintenance.");
  t(E,"It is safe to wear loose clothing near rotating machinery.",false,"Loose clothing can be caught and cause serious injury.");
  t(M,"Coolant in an engine's radiator helps prevent overheating.",true,"Check levels when the engine is cool.");
  o(M,"Arrange a routine generator service in order.",["Isolate and allow the engine to cool","Drain old oil and replace the oil filter","Replace or clean the air and fuel filters","Refill with the correct oil and check coolant","Test-run and record in the maintenance log"],"A consistent routine extends generator life.");
  s(E,"What hand-held instrument measures small dimensions to 0.01 mm?",["micrometer","micrometre","micrometer screw gauge","micrometer screw guage"],"Vernier calipers are less precise.");
  m(M,"The function of a thermostat in an engine cooling system is to:",["Pump water","Regulate coolant flow to keep the engine at operating temperature","Filter oil","Start the engine"],1,"A stuck thermostat can cause overheating.");
  m(M,"Welding safety requires:",["No eye protection","A suitable welding shield, gloves, ventilation and fire precautions","Working near fuel","Bare hands"],1,"Arc light can cause eye injury ('arc eye').");
  m(E,"A fire extinguisher suitable for the workshop should be:",["Hidden","Easily accessible and regularly inspected","Locked away","Used as a doorstop"],1,"Workshops contain flammable materials.");

  /* ---------------- Technical Officer (Electrical) ---------------- */
  cadre("Technical Officer (Electrical) Cadre");
  m(M,"In domestic wiring, lighting circuits commonly use cable of:",["0.5 mm²","1.5 mm²","6 mm²","16 mm²"],1,"Socket circuits commonly use 2.5 mm² cable.");
  m(E,"A multimeter can measure:",["Only resistance","Voltage, current and resistance","Only temperature","Only light"],1,"Select the correct range and function before testing.");
  m(M,"A continuity test checks that:",["Voltage is present","A conductor or circuit has an unbroken path","A fuse is hot","The meter is new"],1,"Done with the supply isolated.");
  m(E,"Before working on a circuit, the technician should:",["Work on it live","Switch off, isolate and confirm it is dead with a tester","Ask someone to hold the switch","Use wet hands"],1,"Never assume a circuit is dead.");
  m(M,"An MCB that trips repeatedly most likely indicates:",["Normal operation","An overload or a fault on the circuit","A new installation","Low voltage only"],1,"Find the cause; do not replace with a larger rating.");
  m(E,"In IEC colour coding, the protective earth conductor is:",["Brown","Blue","Green/yellow","Red"],2,"Brown = line, blue = neutral.");
  m(M,"Which lamp type is most energy-efficient for office lighting?",["Incandescent","LED","Halogen","Candle"],1,"LEDs use far less energy for the same light.");
  m(M,"Three 60 W lamps and a 1,500 W heater run together on 230 V. The total current is about:",["5 A","7.3 A","10 A","1.7 A"],1,"Total power = 180 + 1,500 = 1,680 W; I = 1,680 ÷ 230 ≈ 7.3 A.");
  m(M,"A lightning arrester (surge protection) on a building:",["Attracts electricity bills","Provides a safe path to earth for lightning or surges","Increases voltage","Saves water"],1,"It protects the building and equipment.");
  m(M,"Conduits are used in electrical installations to:",["Increase current","Protect cables mechanically and allow rewiring","Store energy","Cool cables completely"],1,"PVC and steel conduits are common.");
  m(M,"In an inverter system, batteries store energy as:",["AC","DC","Heat","Light"],1,"The inverter converts it to AC.");
  m(M,"Insulation resistance testing (megger) must be done:",["With the supply on","With the circuit isolated and sensitive equipment disconnected","In the rain","With bare hands on conductors"],1,"Test voltages can damage electronics.");
  x(E,"Match each device to its function.",[["Fuse/MCB","Overcurrent protection"],["RCD","Earth leakage (shock) protection"],["Distribution board","Divides supply into circuits"],["Isolator","Disconnects supply for safe work"]],"Basic protective and control devices.");
  t(E,"Water and electricity are a dangerous combination; never handle electrical equipment with wet hands.",true,"Water lowers skin resistance, increasing shock risk.");
  t(M,"Replacing a blown fuse with a thicker wire is a safe temporary repair.",false,"It removes protection and can cause fires.");
  t(M,"Switches should break the live conductor.",true,"So the appliance is dead when switched off.");
  o(E,"Arrange the steps to replace a faulty socket outlet safely.",["Switch off and isolate the circuit","Confirm it is dead with a tester","Remove the faulty socket","Connect the new socket correctly (L, N, E)","Restore power and test"],"Safe isolation comes first.");
  s(E,"What colour is the neutral conductor under IEC colour coding?",["blue"],"Line is brown; earth is green/yellow.");
  m(M,"Prepaid electricity meters record consumption in:",["Litres","kWh","Volts","Amperes only"],1,"Tokens purchase kWh units.");
  m(M,"An electric shock victim still in contact with the source should first be:",["Pulled by the hand","Separated from the source by switching off the supply or using a dry non-conductive object","Splashed with water","Left alone"],1,"Protect yourself first, then give first aid and call for help.");

  /* ---------------- Technical Officer (Town Planning) ---------------- */
  cadre("Technical Officer (Town Planning) Cadre");
  m(M,"On land-use maps, the conventional colour for residential use is usually:",["Red","Yellow","Purple","Green"],1,"Commercial is often red, industrial purple and open space green.");
  m(E,"On a land-use map, green usually represents:",["Industry","Open space and recreation","Commercial","Residential"],1,"Colour conventions make maps easy to read.");
  m(M,"During a development-control site inspection, the technical officer checks mainly that:",["The owner is wealthy","Construction complies with the approved plan and permit (setbacks, height, use)","Workers are paid","The paint matches"],1,"Deviations are reported for enforcement.");
  m(M,"A building is 3 m from the boundary but the approved setback is 4.5 m. This is:",["Compliant","A setback contravention","An approved variation automatically","A survey error only"],1,"It should be documented and reported.");
  m(E,"On a plan at 1:500, 2 cm represents:",["2 m","10 m","100 m","50 m"],1,"2 cm × 500 = 1,000 cm = 10 m.");
  m(M,"Planning applications in Lagos are processed and permits issued by:",["LASPPPA","LASWA","LASTMA","LIRS"],0,"The Lagos State Physical Planning Permit Authority.");
  m(M,"A survey plan accompanying a planning application shows:",["The building's colours","The plot's boundaries, beacons, dimensions and coordinates","Furniture layout","Owner's income"],1,"It establishes the legal extent of the plot.");
  m(M,"Before a contravention notice is served, the officer should:",["Assume guilt","Inspect, measure, photograph and record the contravention accurately","Collect money","Ignore the owner"],1,"Accurate evidence supports enforcement.");
  m(M,"A plot measures 18 m × 36 m. Its area is:",["54 m²","648 m²","324 m²","1,296 m²"],1,"18 × 36 = 648 m².");
  m(M,"Map scale 1:2,500 is larger-scale (more detailed) than 1:50,000 because:",["It covers a bigger area","Each map unit represents a smaller ground distance","It uses colour","It is newer"],1,"Larger-scale maps show more detail over smaller areas.");
  m(M,"A GIS layer showing roads, overlaid on a layer showing plots, helps the officer to:",["Print money","Identify encroachment on road setbacks and rights of way","Collect tax","Draw buildings"],1,"Spatial overlay supports enforcement.");
  m(E,"A handheld GPS receiver is used in the field to:",["Measure noise","Record the coordinates of locations","Test soil","Count people"],1,"Useful for locating and mapping sites.");
  x(M,"Match each document to its purpose.",[["Planning permit","Authorises development"],["Survey plan","Defines plot boundaries"],["Contravention notice","Notifies a breach of regulations"],["Stop-work order","Halts unauthorised construction"]],"Key development-control documents.");
  t(E,"North point and scale should appear on every site plan.",true,"They orient and size the drawing.");
  t(M,"A permit holder may change the approved use of a building from residential to commercial without approval.",false,"Change of use requires planning approval.");
  t(M,"Photographs with dates and locations strengthen inspection reports.",true,"They provide objective evidence.");
  o(M,"Arrange the steps of a routine development-control inspection.",["Review the approved plan and permit","Visit the site and identify the plot","Measure setbacks, heights and coverage","Photograph and record findings","Write the inspection report and recommendation"],"Preparation and documentation make inspections defensible.");
  s(E,"What colour usually represents commercial land use on planning maps? (one word)",["red"],"Colour conventions vary slightly between agencies.");
  m(M,"A building covers 450 m² of a 900 m² plot. Its plot coverage is:",["20%","50%","45%","200%"],1,"450 ÷ 900 × 100 = 50%.");
  m(M,"A stop-work order is served when:",["Work is complete","Construction is proceeding without a permit or in breach of it","A building is old","The owner pays tax"],1,"Work must stop until the breach is resolved.");

  for(var n in out)out[n].forEach(function(z){z.scope=n;});
  return out;
})();


/* ==================== inlined from cbt-bank-prof-science.js ==================== */
/* ============================================================
   PROFESSIONAL KNOWLEDGE — agriculture, veterinary, natural-resources
   and scientific officer cadres. 20 questions per cadre.
   Shared file (browser + Apps Script).
   ============================================================ */
var SEED_PROF_SCIENCE=(function(){
  var out={},cur=null,C="Professional Knowledge",E="easy",M="medium",H="hard";
  function cadre(n){cur=out[n]=[];}
  function q(t,d,stem,x,ex){var o={scope:null,category:C,type:t,difficulty:d,stem:stem,explanation:ex};for(var k in x)o[k]=x[k];cur.push(o);}
  function m(d,stem,o,a,ex){q("mcq",d,stem,{options:o,answer:a},ex);}
  function t(d,stem,a,ex){q("truefalse",d,stem,{answer:a},ex);}
  function s(d,stem,acc,ex){q("shortanswer",d,stem,{accept:acc},ex);}
  function o(d,stem,items,ex){q("ordering",d,stem,{items:items},ex);}
  function x(d,stem,pairs,ex){q("matching",d,stem,{pairs:pairs.map(function(p){return {l:p[0],r:p[1]};})},ex);}

  /* ---------------- Agriculture ---------------- */
  cadre("Agriculture Cadre");
  m(M,"Most arable crops grow best in soils with a pH of about:",["3.0–4.0","6.0–7.0","8.5–9.5","10–11"],1,"Very acidic soils are corrected by liming.");
  m(M,"Urea fertiliser contains about what percentage of nitrogen?",["10%","21%","46%","90%"],2,"Urea is the most concentrated common solid nitrogen fertiliser.");
  m(M,"A farmer applies fertiliser at 200 kg/ha on a 2.5 ha farm. The total fertiliser needed is:",["80 kg","250 kg","500 kg","800 kg"],2,"200 × 2.5 = 500 kg.");
  m(H,"Maize planted at 75 cm × 25 cm with one plant per stand gives a plant population per hectare of about:",["13,333","26,667","53,333","75,000"],2,"10,000 m² ÷ (0.75 × 0.25 m²) ≈ 53,333 plants.");
  m(E,"Cassava is usually propagated by:",["Seeds","Stem cuttings","Tubers","Leaves"],1,"Healthy stem cuttings of 20–25 cm are planted.");
  m(M,"Crop rotation helps mainly to:",["Increase pests","Maintain soil fertility and break pest and disease cycles","Reduce yields","Increase erosion"],1,"Legumes in the rotation also fix nitrogen.");
  m(M,"Integrated Pest Management (IPM) combines:",["Only chemical sprays","Cultural, biological, mechanical and (as a last resort) chemical methods","Burning farms","Only resistant varieties"],1,"IPM reduces pesticide use, cost and environmental harm.");
  m(M,"The main role of agricultural extension services is to:",["Collect taxes","Transfer knowledge and technologies to farmers and feed back their problems to research","Sell land","Run markets"],1,"Extension links research and farmers.");
  m(M,"The Lagos Rice Mill at Imota is designed to:",["Produce cassava flour","Process paddy into milled rice for the regional market","Make fertiliser","Can fish"],1,"It is one of the largest rice mills in sub-Saharan Africa.");
  m(M,"The Lagos State agency that implements agricultural development programmes and extension is the:",["LADA (Lagos State Agricultural Development Authority)","LASTMA","LASWA","LAWMA"],0,"It works with farmers across the State.");
  m(M,"Drip irrigation is preferred in water-scarce areas because it:",["Floods the field","Delivers water directly to roots with minimal losses","Uses more water","Needs no pipes"],1,"It is the most water-efficient common method.");
  m(M,"Broiler chickens are raised mainly for:",["Eggs","Meat","Feathers","Draught power"],1,"Layers are raised for eggs.");
  x(M,"Match each crop to its usual propagation material.",[["Yam","Seed yams / setts"],["Plantain","Suckers"],["Maize","Seeds (grains)"],["Pineapple","Suckers, slips or crowns"]],"Correct planting material affects yield.");
  o(M,"Arrange the stages of crop production in order.",["Land preparation","Planting","Weeding and fertiliser application","Pest and disease control","Harvesting","Storage and marketing"],"Good post-harvest handling reduces losses.");
  t(E,"Legumes such as cowpea can fix atmospheric nitrogen through root nodules.",true,"Rhizobium bacteria in the nodules fix nitrogen.");
  t(M,"Post-harvest losses in Nigeria are negligible.",false,"Significant losses occur through poor storage, handling and processing.");
  t(M,"Fadama refers to low-lying, seasonally flooded land suitable for dry-season farming.",true,"Fadama projects supported irrigation and rural infrastructure.");
  s(E,"What do the letters NPK on a fertiliser bag stand for? (give the three nutrients, e.g. 'nitrogen phosphorus potassium')",["nitrogen phosphorus potassium","nitrogen, phosphorus, potassium","nitrogen phosphorous potassium"],"These are the primary plant macronutrients.");
  m(M,"Mulching in crop production helps to:",["Increase weeds","Conserve soil moisture, suppress weeds and reduce erosion","Kill crops","Raise soil temperature to harmful levels only"],1,"Organic mulch also adds organic matter.");
  m(H,"Vaccinating poultry against Newcastle disease is best done:",["After an outbreak only","According to a scheduled programme from an early age","Never","Only for old birds"],1,"Scheduled vaccination prevents devastating losses.");

  /* ---------------- Fisheries ---------------- */
  cadre("Fisheries Cadre");
  m(E,"The most widely cultured fish species in Nigeria is the:",["Atlantic salmon","African catfish (Clarias gariepinus)","Trout","Shark"],1,"Tilapia is also commonly farmed.");
  m(M,"Dissolved oxygen in fish ponds should generally be kept above about:",["0.5 mg/L","5 mg/L","50 mg/L","100 mg/L"],1,"Low oxygen stresses or kills fish, especially at dawn.");
  m(M,"The suitable pH range for most pond fish is about:",["3.0–4.5","6.5–8.5","9.5–11","12–14"],1,"Liming corrects acidic ponds.");
  m(H,"Fish fed 150 kg of feed gained 100 kg in weight. The feed conversion ratio (FCR) is:",["0.67","1.5","2.5","15"],1,"FCR = feed given ÷ weight gain = 150 ÷ 100 = 1.5. Lower is better.");
  m(M,"Overfeeding fish in ponds mainly causes:",["Faster growth only","Water pollution, ammonia build-up and oxygen depletion","Cleaner water","No effect"],1,"Uneaten feed decomposes.");
  m(M,"Induced breeding of catfish in hatcheries uses:",["Antibiotics","Hormones such as pituitary extract or synthetic preparations (e.g. Ovaprim)","Vaccines","Salt only"],1,"Hormones trigger ovulation.");
  m(M,"Most fish landed in Nigeria comes from:",["Industrial trawlers only","Artisanal (small-scale) fisheries","Aquariums","Imports only"],1,"Artisanal fishers dominate inland and coastal catches.");
  m(M,"The Chorkor smoker is an improved kiln used for:",["Drying cocoa","Smoking fish more efficiently and hygienically","Making ice","Hatching fingerlings"],1,"It reduces fuelwood use and improves quality.");
  m(M,"Regulating the minimum mesh size of fishing nets mainly helps to:",["Catch more juveniles","Allow juvenile fish to escape and grow, sustaining stocks","Reduce costs","Increase by-catch"],1,"It prevents growth overfishing.");
  m(M,"A country's Exclusive Economic Zone extends up to:",["12 nautical miles","24 nautical miles","200 nautical miles","500 nautical miles"],2,"Under UNCLOS; the territorial sea is 12 nautical miles.");
  m(M,"Fresh fish should be kept on ice mainly to:",["Add weight","Slow bacterial spoilage and enzymatic deterioration","Change colour","Remove scales"],1,"Fish spoils quickly at tropical temperatures.");
  m(M,"Lagos's fisheries rely heavily on the:",["Sahara desert","Lagos Lagoon, creeks and the Atlantic coast","Lake Chad","River Benue only"],1,"Lagos has extensive lagoon and coastal fisheries.");
  x(M,"Match each stage of fish to its description.",[["Fry","Newly hatched fish that have started feeding"],["Fingerling","Young fish about finger size, used for stocking"],["Juvenile","Growing fish before maturity"],["Broodstock","Mature fish used for breeding"]],"Terms used in hatchery and grow-out.");
  o(M,"Arrange the main steps in a pond fish-farming cycle.",["Pond preparation (draining, liming, fertilising)","Stocking with fingerlings","Feeding and water quality management","Monitoring growth and health","Harvesting and marketing"],"Good preparation and management raise survival and yield.");
  t(E,"Tilapia and catfish are both freshwater species commonly cultured in Nigeria.",true,"They tolerate a range of pond conditions.");
  t(M,"Stocking ponds far above recommended density always increases profit.",false,"Overstocking causes stress, disease and poor growth.");
  t(M,"Liming acidic ponds can improve water quality and pond productivity.",true,"Lime raises pH and alkalinity.");
  s(M,"Feed given is 300 kg and weight gain is 200 kg. What is the FCR? (number only)",["1.5"],"300 ÷ 200 = 1.5.");
  m(H,"Fish gasping at the water surface at dawn most likely indicates:",["Too much oxygen","Low dissolved oxygen","Cold water","Good health"],1,"Oxygen is lowest at dawn after night-time respiration.");
  m(M,"Aquaculture differs from capture fisheries because it:",["Uses only the sea","Involves farming fish under controlled conditions","Never uses feed","Is illegal"],1,"Capture fisheries harvest wild stocks.");

  /* ---------------- Produce Inspection ---------------- */
  cadre("Produce Inspection Cadre");
  m(M,"The maximum moisture content generally required for export-grade cocoa beans is about:",["2%","7.5%","15%","25%"],1,"Wetter beans go mouldy in storage and transit.");
  m(M,"Grains such as maize are generally safe to store at a moisture content of about:",["13% or less","25%","35%","50%"],0,"Higher moisture encourages mould and insects.");
  m(M,"Aflatoxins in stored produce are produced by:",["Weevils","Moulds such as Aspergillus flavus","Rats","Sunlight"],1,"Aflatoxins are carcinogenic and restrict exports.");
  m(M,"The 'cut test' on cocoa beans assesses:",["Weight","Defects such as mouldy, slaty and insect-damaged beans","Price","Colour of the sack"],1,"Beans are cut lengthwise and inspected.");
  m(M,"A representative sample is important in produce inspection because:",["It is cheaper","Grades must reflect the whole consignment, not only the top layer","It saves paper","It is required for photos"],1,"Samples are drawn from different bags and positions.");
  m(M,"Phosphine fumigation of stored produce must be done:",["By anyone without protection","By trained personnel under gas-tight conditions with safety precautions","In occupied rooms","Without notices"],1,"Phosphine is highly toxic to humans.");
  m(M,"A phytosanitary certificate for plant exports in Nigeria is issued by:",["NAQS (Nigeria Agricultural Quarantine Service)","NAFDAC","NCC","NBC"],0,"It certifies freedom from regulated pests and diseases.");
  m(M,"Hermetic storage bags (e.g. PICS bags) protect grain by:",["Adding pesticides","Cutting off oxygen so insects die","Increasing moisture","Allowing ventilation"],1,"They are an effective chemical-free method.");
  m(M,"The agency that promotes non-oil exports in Nigeria is the:",["NEPC (Nigerian Export Promotion Council)","NNPC","CBN","FIRS"],0,"Produce quality affects export competitiveness.");
  m(M,"After inspection and grading, produce bags are:",["Left unmarked","Sealed and marked with grade and inspection details","Opened again","Repacked randomly"],1,"Marking and sealing prevent substitution.");
  m(M,"Weevil infestation in stored grain mainly causes:",["Higher quality","Weight loss, quality loss and contamination","Better germination","No damage"],1,"Infested produce may be rejected.");
  m(H,"A 100 kg bag of beans at 18% moisture is dried to 12% moisture. Its approximate new weight is:",["94.0 kg","93.2 kg","88.0 kg","82.0 kg"],1,"Dry matter = 82 kg; at 12% moisture, weight = 82 ÷ 0.88 ≈ 93.2 kg.");
  x(M,"Match each defect to its likely cause.",[["Mouldy beans","Poor drying or wet storage"],["Slaty cocoa beans","Inadequate fermentation"],["Insect-damaged beans","Pest infestation in storage"],["Germinated beans","Moisture causing sprouting"]],"Identifying causes helps advise farmers.");
  o(M,"Arrange the steps of a produce inspection.",["Receive the consignment and documents","Draw representative samples","Carry out tests (moisture, cut test, foreign matter)","Grade the produce","Seal, mark and certify"],"Systematic inspection gives reliable grades.");
  t(E,"Foreign matter such as stones and sticks reduces the grade of produce.",true,"Grading standards limit foreign matter.");
  t(M,"Produce that fails inspection should be certified anyway to help the exporter.",false,"False certification damages the country's export reputation.");
  t(M,"Good drying and clean storage are the best defences against aflatoxin contamination.",true,"Prevention is better than testing and rejection.");
  s(M,"What is the name of the toxin produced by Aspergillus moulds in stored grains and nuts?",["aflatoxin","aflatoxins"],"Strict limits apply in export markets.");
  m(M,"Produce inspectors advise farmers mainly on:",["Politics","Harvesting, processing, drying and storage practices that maintain quality","Land disputes","Bank loans only"],1,"Quality starts on the farm.");
  m(E,"A moisture meter is used to:",["Weigh bags","Measure the moisture content of produce","Count beans","Seal bags"],1,"Moisture content is a key grading factor.");

  /* ---------------- Veterinary ---------------- */
  cadre("Veterinary Cadre");
  m(M,"Veterinarians in Nigeria are registered by the:",["MDCN","Veterinary Council of Nigeria (VCN)","PCN","NAFDAC"],1,"VCN regulates veterinary practice.");
  m(E,"Rabies is mainly transmitted to humans through:",["Mosquito bites","Bites of infected animals, especially dogs","Contaminated water","Air"],1,"It is almost always fatal once symptoms appear.");
  m(M,"The most effective way to prevent human rabies in a community is:",["Killing all cats","Regular vaccination of dogs plus prompt post-exposure treatment for bite victims","Avoiding all animals","Antibiotics"],1,"Dog vaccination interrupts transmission at its source.");
  m(M,"Newcastle disease is an important viral disease of:",["Cattle","Poultry","Fish","Dogs"],1,"Vaccination controls it.");
  m(M,"African swine fever is especially serious because:",["It is mild","There is no effective vaccine and mortality is very high","It affects only cattle","It is cured by antibiotics"],1,"Control relies on biosecurity and culling.");
  m(M,"Peste des petits ruminants (PPR) affects:",["Poultry","Sheep and goats","Horses","Fish"],1,"It causes high mortality in small ruminants.");
  m(M,"An anthrax-suspect carcass should NOT be:",["Reported","Opened, because spores form on exposure to air","Disposed of safely","Isolated"],1,"Opening it releases spores that persist in soil for years.");
  m(M,"Ante-mortem inspection at an abattoir is carried out:",["After slaughter","On live animals before slaughter","On meat in markets","On hides only"],1,"Post-mortem inspection examines the carcass and organs after slaughter.");
  m(M,"Lagos State's major abattoir complex is located at:",["Oko-Oba, Agege","Epe","Badagry","Lekki"],0,"It is the State's main meat-processing hub.");
  m(M,"The 'One Health' approach recognises that:",["Only human health matters","Human, animal and environmental health are interconnected","Animals cannot spread disease","Vets should not work with doctors"],1,"Most emerging diseases are zoonotic.");
  m(M,"A drug withdrawal period is:",["The time a vet withdraws from practice","The time after treatment before an animal's meat, milk or eggs can be used for food","Price reduction","Vaccine storage time"],1,"It prevents drug residues in food.");
  m(M,"The normal rectal temperature of a dog is about:",["35°C","38.5°C","41°C","33°C"],1,"About 38–39°C; higher suggests fever.");
  x(M,"Match each animal to its approximate gestation period.",[["Cow","About 9 months (≈283 days)"],["Goat","About 5 months (≈150 days)"],["Pig","About 3 months, 3 weeks, 3 days (≈114 days)"],["Dog","About 2 months (≈63 days)"]],"Gestation periods guide breeding management.");
  x(H,"Match each zoonotic disease to an animal source.",[["Brucellosis","Cattle, goats (unpasteurised milk)"],["Bovine TB","Cattle"],["Lassa fever","Multimammate rats"],["Avian influenza","Poultry"]],"Zoonoses require joint human–animal surveillance.");
  o(M,"Arrange the steps of responding to a suspected notifiable animal disease outbreak.",["Report to the veterinary authority","Isolate affected animals and restrict movement","Collect samples for laboratory confirmation","Implement control measures (vaccination, culling, disinfection)","Monitor and lift restrictions when safe"],"Rapid reporting and containment limit spread.");
  t(E,"Biosecurity measures on farms include footbaths, restricted visitors and quarantine of new animals.",true,"They keep diseases out.");
  t(M,"Antibiotics should be given routinely to healthy animals to promote growth.",false,"This drives antimicrobial resistance; use them only as prescribed.");
  s(M,"What is the name for diseases transmitted between animals and humans?",["zoonoses","zoonosis","zoonotic diseases","zoonotic"],"E.g. rabies, anthrax, brucellosis.");
  m(M,"Highly pathogenic avian influenza (H5N1) outbreaks in poultry are usually controlled by:",["Ignoring them","Culling infected flocks, movement control, disinfection and compensation","Antibiotics","Releasing birds"],1,"Rapid stamping out prevents spread.");
  m(M,"Deworming livestock regularly helps to:",["Reduce weight","Control internal parasites that reduce growth and productivity","Change coat colour","Increase disease"],1,"Strategic deworming avoids resistance.");

  /* ---------------- Forestry ---------------- */
  cadre("Forestry Cadre");
  m(M,"Afforestation means:",["Cutting down forests","Planting trees on land that has not recently been forest","Replanting a recently felled forest","Burning bush"],1,"Reforestation is replanting where forest was recently removed.");
  m(M,"The Taungya system involves:",["Logging only","Farmers growing food crops between young forest trees during plantation establishment","Fish farming","Charcoal production"],1,"It was widely used in Nigerian plantations.");
  m(M,"Common exotic plantation species in southern Nigeria include:",["Teak and Gmelina","Baobab and acacia only","Pine only","Mangrove only"],0,"They grow fast and supply timber and poles.");
  m(M,"Diameter at breast height (DBH) is measured at about:",["0.5 m","1.3 m above ground","3 m","At the top of the tree"],1,"DBH is the standard tree-measurement height.");
  m(M,"Silviculture is:",["Silver mining","The science and practice of establishing, growing and tending forests","Wood carving","Paper making"],1,"It covers regeneration, thinning and protection.");
  m(M,"Mangrove forests along the Lagos coast are important because they:",["Have no value","Protect shorelines, serve as fish nurseries and store carbon","Cause flooding","Are only firewood"],1,"Mangroves are threatened by urban expansion.");
  m(M,"The Lekki Conservation Centre is managed by the:",["Nigerian Conservation Foundation","LASTMA","FRSC","LAWMA"],0,"It protects a portion of the Lekki wetland ecosystem.");
  m(M,"Sustainable yield in forestry means:",["Cutting all trees at once","Harvesting no more timber than the forest regrows over time","Never harvesting","Burning forests"],1,"It maintains forest resources for the future.");
  m(M,"Planting trees at a spacing of 3 m × 3 m gives about how many trees per hectare?",["333","1,111","3,333","10,000"],1,"10,000 m² ÷ 9 m² ≈ 1,111 trees.");
  m(M,"Timber seasoning means:",["Painting timber","Drying timber to a suitable moisture content to improve strength and stability","Cutting timber","Soaking timber in water permanently"],1,"Air drying and kiln drying are common methods.");
  m(M,"CITES regulates:",["Fishing nets","International trade in endangered species of wild fauna and flora","Timber prices","Carbon credits only"],1,"It protects species threatened by trade.");
  m(M,"Forests contribute to climate change mitigation mainly by:",["Emitting oxygen only","Sequestering carbon dioxide in biomass and soils","Raising temperatures","Producing methane"],1,"Deforestation releases stored carbon.");
  x(M,"Match each term to its meaning.",[["Thinning","Removing some trees to give others space to grow"],["Agroforestry","Combining trees with crops or livestock"],["Forest reserve","Area legally set aside for forest management"],["Nursery","Place where seedlings are raised before planting"]],"Basic forestry vocabulary.");
  o(M,"Arrange the steps of establishing a forest plantation.",["Site selection and survey","Raising seedlings in the nursery","Land preparation","Planting","Weeding and maintenance","Thinning and protection"],"Careful establishment determines plantation success.");
  t(E,"Deforestation can increase soil erosion and flooding.",true,"Tree cover protects soil and regulates water flow.");
  t(M,"Bush burning is a sound way to manage forest reserves.",false,"Uncontrolled fires destroy regeneration and biodiversity.");
  t(M,"Agroforestry can improve soil fertility and diversify farmers' incomes.",true,"Trees provide shade, fodder, fuel and nutrients.");
  s(E,"What term describes replanting trees on recently cleared forest land?",["reforestation","reafforestation"],"Afforestation is planting where there was no recent forest.");
  m(H,"Selective logging that removes only the best trees repeatedly is called 'high-grading' and leads to:",["Better forests","Degradation of forest quality and genetic stock","More timber over time","No change"],1,"Poor trees are left to regenerate the stand.");
  m(M,"Forest guards mainly protect forest reserves against:",["Rain","Illegal logging, encroachment, fire and poaching","Tourists","Research"],1,"Enforcement maintains reserve integrity.");

  /* ---------------- Geology ---------------- */
  cadre("Geology Cadre");
  x(M,"Match each rock to its type.",[["Granite","Igneous"],["Sandstone","Sedimentary"],["Marble","Metamorphic"],["Basalt","Igneous (volcanic)"]],"Rocks are classified by how they formed.");
  m(M,"Lagos is underlain mainly by:",["Precambrian basement granites","Sedimentary deposits of the Dahomey (Benin) Basin","Volcanic rocks","Coal measures"],1,"Much of south-western Nigeria inland is basement complex.");
  m(M,"On Mohs' scale of hardness, the hardest mineral (10) is:",["Quartz","Talc","Diamond","Corundum"],2,"Talc is 1; quartz is 7.");
  m(M,"Porosity is the proportion of a rock that is:",["Solid","Pore space","Water-saturated only","Metal"],1,"Permeability is the ability to transmit fluids.");
  m(M,"Excessive groundwater abstraction in coastal Lagos can cause:",["More rainfall","Saltwater intrusion and land subsidence","Earthquakes only","Volcanoes"],1,"Over-pumping lowers water tables near the coast.");
  m(M,"Vertical Electrical Sounding (VES) is commonly used to:",["Find oil only","Investigate subsurface layers and locate groundwater","Measure rainfall","Date fossils"],1,"Resistivity contrasts reveal aquifers.");
  m(M,"The agency responsible for geological mapping and data in Nigeria is the:",["NGSA (Nigerian Geological Survey Agency)","NIMET","NNPC only","SON"],0,"It produces geological maps and mineral data.");
  m(M,"Nigeria's large bitumen deposits are found mainly in:",["Ondo, Ogun and Edo States","Sokoto","Borno","Kano"],0,"The bitumen belt runs through these states.");
  m(M,"'Strike and dip' describe the:",["Age of a rock","Orientation of a rock layer or plane","Hardness of minerals","Colour of soil"],1,"Strike is the horizontal direction; dip is the angle of inclination.");
  m(M,"A fault is:",["A fold in rocks","A fracture along which rocks have moved","A type of mineral","A water well"],1,"Folds bend rocks without breaking them.");
  m(M,"An aquifer is:",["A layer that blocks water","A rock or sediment layer that stores and transmits usable groundwater","A river","A cloud"],1,"Aquitards restrict flow.");
  m(M,"Chemical weathering is especially active in:",["Cold deserts","Hot, humid climates like southern Nigeria","Polar regions","High mountains only"],1,"Warmth and moisture speed chemical reactions.");
  o(M,"Arrange these geological eras from oldest to youngest.",["Precambrian","Palaeozoic","Mesozoic","Cenozoic"],"The Cenozoic is the current era.");
  t(E,"Sedimentary rocks may contain fossils.",true,"Fossils are preserved in sediments.");
  t(M,"Clay layers usually have high permeability.",false,"Clays have high porosity but very low permeability.");
  t(M,"Geotechnical investigations help determine suitable foundations for buildings.",true,"They assess soil strength and groundwater.");
  s(E,"What type of rock forms from cooled magma or lava?",["igneous","igneous rock"],"Examples include granite and basalt.");
  m(H,"Land subsidence in parts of coastal Lagos increases the risk of:",["Drought","Flooding and structural damage","Volcanic activity","Desertification"],1,"Lower land levels worsen flood exposure.");
  m(M,"The Precambrian Basement Complex in Nigeria hosts many:",["Oil fields","Solid minerals such as gold, tin and gemstones","Coal seams only","Limestone only"],1,"Sedimentary basins host oil, coal and limestone.");
  m(M,"Geological maps are important for:",["Weather forecasting","Mineral exploration, groundwater development, engineering and land-use planning","Tax collection","Traffic control"],1,"They show rock distribution and structures.");

  /* ---------------- Scientific Officer (Mining) ---------------- */
  cadre("Scientific Officer (Mining) Cadre");
  m(M,"The principal federal law governing solid minerals in Nigeria is the:",["Petroleum Industry Act","Nigerian Minerals and Mining Act 2007","Land Use Act only","Environmental Act"],1,"It regulates exploration and mining of solid minerals.");
  m(M,"Under the 1999 Constitution, ownership and control of all minerals in Nigeria is vested in the:",["States","Federal Government","Landowners","Local governments"],1,"Section 44(3).");
  m(M,"Mineral titles in Nigeria are administered by the:",["Mining Cadastre Office","NAFDAC","LASTMA","CBN"],0,"It issues and manages mineral titles.");
  x(M,"Match each mineral title to its purpose.",[["Reconnaissance permit","Preliminary, non-exclusive search for minerals"],["Exploration licence","Exclusive detailed exploration"],["Mining lease","Large-scale mining"],["Quarry lease","Extraction of construction materials"]],"Titles progress with the stage of activity.");
  m(M,"Ore is:",["Waste rock","Rock containing minerals that can be extracted at a profit","Topsoil","Water"],1,"Gangue is the worthless material associated with ore.");
  m(M,"An orebody of 500 tonnes grades 2% copper. The copper content is:",["1 tonne","10 tonnes","25 tonnes","100 tonnes"],1,"500 × 0.02 = 10 tonnes.");
  m(M,"If 300 tonnes of waste must be removed to mine 100 tonnes of ore, the stripping ratio is:",["1:3","3:1","300:1","1:1"],1,"Waste ÷ ore = 3:1.");
  o(M,"Arrange the basic stages of mineral processing.",["Crushing","Grinding","Concentration (e.g. gravity, flotation)","Dewatering","Refining or smelting"],"Processing liberates and concentrates valuable minerals.");
  m(M,"Tailings dams store:",["Drinking water","Waste slurry left after mineral processing","Explosives","Ore for export"],1,"Dam failures can cause disasters and pollution.");
  m(M,"The 2010 lead-poisoning crisis in Zamfara State resulted mainly from:",["Oil spills","Unsafe artisanal gold ore processing in villages","Industrial chemicals","Contaminated rice"],1,"Many children died from lead exposure.");
  m(M,"Enugu is historically known for mining of:",["Tin","Coal","Gold","Bitumen"],1,"Coal was discovered there in 1909.");
  m(M,"The Jos Plateau is historically known for:",["Coal","Tin and columbite","Oil","Diamonds"],1,"Tin mining shaped the region's economy.");
  m(M,"Mine closure plans should provide for:",["Abandonment without action","Land reclamation and rehabilitation after mining","Selling equipment only","Leaving open pits"],1,"Reclamation is required by law.");
  m(M,"Limestone is a key raw material for:",["Cement production","Steel only","Fertiliser only","Glass only"],0,"Nigeria's cement industry depends on limestone deposits.");
  t(E,"An Environmental Impact Assessment is required before large mining projects start.",true,"It identifies and mitigates environmental and social impacts.");
  t(M,"Artisanal miners face no health or safety risks.",false,"They face risks from pit collapse, dust, mercury and lead.");
  t(M,"Open-pit mining is generally used for shallow, large orebodies.",true,"Deep or narrow orebodies may require underground mining.");
  s(M,"What is the worthless material associated with ore called?",["gangue"],"It is separated during processing.");
  m(H,"Use of mercury in artisanal gold processing is dangerous because:",["It is expensive","Mercury vapour and contamination cause serious neurological harm and pollution","It reduces gold","It is illegal everywhere only"],1,"The Minamata Convention aims to reduce mercury use.");
  m(M,"Explosives used in quarrying should be stored:",["In offices","In licensed magazines under strict security and records","In vehicles","In homes"],1,"Strict control prevents accidents and misuse.");

  /* ---------------- Scientific Officer (Water) ---------------- */
  cadre("Scientific Officer (Water) Cadre");
  o(M,"Arrange the conventional stages of surface water treatment.",["Screening","Coagulation and flocculation","Sedimentation","Filtration","Disinfection"],"Each stage removes different contaminants.");
  m(M,"The most common coagulant used in water treatment is:",["Salt","Aluminium sulphate (alum)","Sugar","Chlorine"],1,"Coagulants clump fine particles into settleable flocs.");
  m(M,"The WHO-recommended pH range for drinking water is generally:",["4.0–5.0","6.5–8.5","9.0–10.5","11–12"],1,"Outside this range water may be corrosive or scale-forming.");
  m(M,"Turbidity of treated drinking water should ideally be below about:",["1 NTU (and not above 5 NTU)","50 NTU","100 NTU","500 NTU"],0,"Low turbidity improves disinfection.");
  m(M,"The public water utility responsible for water supply in Lagos is the:",["Lagos Water Corporation","LAWMA","LASEPA","LASWA"],0,"It operates waterworks such as Iju and Adiyan.");
  m(M,"Lagos's water sector regulator is the:",["Lagos State Water Regulatory Commission (LASWARCO)","NAFDAC","NBC","LASTMA"],0,"It regulates water supply and sanitation services.");
  m(M,"'Non-revenue water' refers to:",["Bottled water","Water produced but not billed, due to leaks, theft or metering errors","Rainwater","Wastewater"],1,"Reducing it improves utility finances.");
  m(M,"Water hardness is caused mainly by dissolved:",["Sodium and chloride","Calcium and magnesium","Iron only","Oxygen"],1,"Hard water forms scale and reduces soap lather.");
  m(M,"Excess fluoride in drinking water can cause:",["Rickets","Dental and skeletal fluorosis","Scurvy","Anaemia"],1,"Moderate levels protect teeth; high levels harm them.");
  m(M,"High nitrate in drinking water is especially dangerous for infants because it can cause:",["Blue baby syndrome (methaemoglobinaemia)","Measles","Malaria","Rickets"],0,"Sources include fertilisers and sewage.");
  m(M,"Biochemical Oxygen Demand (BOD) measures:",["Water hardness","The amount of oxygen used by microbes to break down organic matter — an indicator of organic pollution","Salt content","Temperature"],1,"High BOD indicates heavy organic pollution.");
  m(M,"A pumping test on a new borehole determines:",["Water colour","Yield and aquifer characteristics","Price","Depth only"],1,"It informs pump selection and sustainable abstraction.");
  m(M,"A town of 10,000 people with a demand of 120 litres per person per day needs:",["120,000 L/day","1.2 million L/day","12 million L/day","12,000 L/day"],1,"10,000 × 120 = 1,200,000 L/day.");
  m(M,"In a slow sand filter, the biological layer that removes pathogens is called the:",["Scum","Schmutzdecke","Floc","Sludge blanket"],1,"It forms on the sand surface.");
  x(M,"Match each water quality parameter to what it indicates.",[["E. coli","Faecal contamination"],["Turbidity","Suspended particles / cloudiness"],["Residual chlorine","Ongoing disinfection protection"],["Conductivity","Dissolved salts"]],"Routine parameters for water quality monitoring.");
  t(E,"Chlorine is widely used to disinfect drinking water.",true,"It kills most bacteria and viruses.");
  t(M,"Clear water is always safe to drink.",false,"Clear water may still contain pathogens or chemicals.");
  t(M,"A Water Safety Plan manages risks from catchment to consumer.",true,"It is the WHO-recommended approach.");
  s(E,"What chemical is most commonly used to disinfect public water supplies?",["chlorine"],"Chlorine leaves a protective residual.");
  m(H,"Adequate chlorine contact time before water reaches consumers is important because:",["It improves taste only","Disinfection needs time for chlorine to inactivate pathogens","It reduces cost","It removes hardness"],1,"CT (concentration × time) determines effectiveness.");

  for(var n in out)out[n].forEach(function(z){z.scope=n;});
  return out;
})();


/* ==================== inlined from cbt-bank-prof-finance.js ==================== */
/* ============================================================
   PROFESSIONAL KNOWLEDGE — legal, finance, audit, procurement,
   statistics, planning, research, social, media, printing and youth
   cadres. 20 questions per cadre. Shared file (browser + Apps Script).
   ============================================================ */
var SEED_PROF_FINANCE=(function(){
  var out={},cur=null,C="Professional Knowledge",E="easy",M="medium",H="hard";
  function cadre(n){cur=out[n]=[];}
  function q(t,d,stem,x,ex){var o={scope:null,category:C,type:t,difficulty:d,stem:stem,explanation:ex};for(var k in x)o[k]=x[k];cur.push(o);}
  function m(d,stem,o,a,ex){q("mcq",d,stem,{options:o,answer:a},ex);}
  function t(d,stem,a,ex){q("truefalse",d,stem,{answer:a},ex);}
  function s(d,stem,acc,ex){q("shortanswer",d,stem,{accept:acc},ex);}
  function o(d,stem,items,ex){q("ordering",d,stem,{items:items},ex);}
  function x(d,stem,pairs,ex){q("matching",d,stem,{pairs:pairs.map(function(p){return {l:p[0],r:p[1]};})},ex);}

  /* ---------------- Legal ---------------- */
  cadre("Legal Cadre");
  m(M,"The chief law officer of a State is the:",["Chief Judge","Attorney-General and Commissioner for Justice","Solicitor-General","Governor"],1,"Section 195 of the Constitution establishes the office.");
  m(H,"Under section 211 of the Constitution, the State Attorney-General may:",["Only defend the Governor","Institute, take over and discontinue criminal proceedings in State courts","Appoint judges","Dissolve the House of Assembly"],1,"These powers must be exercised in the public interest.");
  m(M,"Under the Public Officers Protection Act/Law, an action against a public officer for an act done in execution of duty must generally be brought within:",["3 months","1 year","6 years","12 years"],0,"Exceptions apply, e.g. continuing injury.");
  o(M,"Arrange the stages of a bill in the State House of Assembly.",["First reading","Second reading","Committee stage","Third reading","Governor's assent"],"A bill becomes law on assent (or by veto override).");
  m(H,"If the Governor withholds assent to a bill, the House of Assembly can pass it into law by a resolution supported by:",["A simple majority","Two-thirds of all members","Three-quarters of members","Unanimous vote"],1,"Section 100(5) of the Constitution.");
  x(M,"Match each prerogative order to its function.",[["Certiorari","Quashes a decision made without jurisdiction or in breach of natural justice"],["Mandamus","Compels a public body to perform a public duty"],["Prohibition","Stops a body from exceeding its jurisdiction"],["Habeas corpus","Secures release of a person unlawfully detained"]],"Remedies in judicial review.");
  m(M,"The doctrine of stare decisis means that:",["Courts may ignore earlier decisions","Lower courts are bound by the decisions of higher courts on similar facts","Statutes override the Constitution","Judges make laws freely"],1,"It promotes certainty and consistency.");
  m(M,"'Locus standi' refers to:",["The court's location","A party's legal standing to bring an action","A type of contract","The burden of proof"],1,"Without standing, a suit may be struck out.");
  m(M,"The essential elements of a valid contract include:",["Offer, acceptance, consideration, intention to create legal relations and capacity","Only a written document","A lawyer's signature","A stamp"],0,"Some contracts also require writing.");
  m(M,"In criminal trials, the prosecution must prove guilt:",["On the balance of probabilities","Beyond reasonable doubt","Beyond all doubt","By confession only"],1,"Civil cases use the balance of probabilities.");
  m(M,"'Mens rea' means:",["The guilty act","The guilty mind (criminal intent)","The trial","The sentence"],1,"Actus reus is the guilty act.");
  m(M,"The Lagos Multi-Door Courthouse, established in 2002, is notable as:",["A prison","The first court-connected ADR centre in Africa","A land registry","A police station"],1,"It offers mediation, arbitration and other ADR options.");
  m(M,"The Lagos State Office of the Public Defender provides:",["Free legal representation and advice to indigent persons","Police services","Tax services","Land titles"],0,"It promotes access to justice.");
  m(M,"Nigeria's current principal law on arbitration and mediation is the:",["Arbitration and Conciliation Act 1988","Arbitration and Mediation Act 2023","Evidence Act 2011","Companies Act"],1,"It replaced the 1988 Act.");
  t(E,"The Constitution is the supreme law, and any law inconsistent with it is void to the extent of the inconsistency.",true,"Section 1(3).");
  t(M,"Pre-action notices are required before suing certain government agencies where the enabling law provides.",true,"Failure to give notice can defeat the suit.");
  t(M,"A State House of Assembly may make laws on any item on the Exclusive Legislative List.",false,"Exclusive items are reserved to the National Assembly.");
  s(M,"What is the Latin term for the legal standing to sue? (two words)",["locus standi"],"A claimant must show sufficient interest.");
  m(H,"When drafting legislation, the section that defines key terms used in the law is the:",["Long title","Interpretation section","Schedule","Commencement clause"],1,"Definitions avoid ambiguity.");
  m(M,"Sources of Nigerian law include:",["Only the Constitution","The Constitution, legislation, received English law, customary law, Islamic law and judicial precedent","Only customary law","Only English law"],1,"Nigeria has a plural legal system.");

  /* ---------------- Statistics (graduate) ---------------- */
  cadre("Statistics Cadre (graduate)");
  x(M,"Match each sampling method to its description.",[["Simple random","Every unit has an equal chance of selection"],["Stratified","Population divided into groups, then sampled within each"],["Cluster","Groups (e.g. villages) selected, then units within them surveyed"],["Systematic","Every k-th unit selected from a list"]],"Choice depends on the frame, cost and precision needed.");
  m(M,"A Type I error occurs when:",["A false null hypothesis is accepted","A true null hypothesis is rejected","The sample is too large","Data are missing"],1,"Its probability is the significance level α.");
  m(M,"A p-value of 0.03 at the 5% significance level means:",["Accept the null hypothesis","Reject the null hypothesis","The study is invalid","The effect is large"],1,"p < 0.05 indicates statistical significance (not necessarily practical importance).");
  m(M,"The correlation coefficient r ranges from:",["0 to 1","−1 to +1","−∞ to +∞","0 to 100"],1,"0 means no linear relationship.");
  m(M,"In a normal distribution, about 95% of values lie within:",["±1 standard deviation","±1.96 standard deviations of the mean","±3 standard deviations","±0.5 standard deviations"],1,"About 68% lie within ±1 SD and 99.7% within ±3 SD.");
  m(M,"With a population standard deviation of 20 and a sample size of 100, the standard error of the mean is:",["0.2","2","20","200"],1,"SE = σ ÷ √n = 20 ÷ 10 = 2.");
  m(H,"The data set 2, 4, 4, 4, 5, 5, 7, 9 has a mean of 5. Its population standard deviation is:",["1","2","3","4"],1,"Squared deviations sum to 32; variance = 32 ÷ 8 = 4; SD = 2.");
  m(M,"The national agency responsible for official statistics in Nigeria is the:",["NBS (National Bureau of Statistics)","CBN","NPC only","NIMC"],0,"The NBS coordinates the National Statistical System.");
  m(M,"Lagos State's statistics office is the:",["Lagos Bureau of Statistics","LIRS","LASRRA","LASEPA"],0,"It produces State-level statistics such as the Abstract of Local Government Statistics.");
  m(M,"The Consumer Price Index (CPI) is used to measure:",["Population","Inflation (changes in the price level of a basket of goods and services)","GDP","Employment"],1,"Headline inflation is the year-on-year change in CPI.");
  m(M,"A Laspeyres price index uses:",["Current-period quantities","Base-period quantities as weights","No weights","Only prices of one item"],1,"The Paasche index uses current-period quantities.");
  m(M,"'Correlation does not imply causation' means:",["Correlations are always wrong","Two variables moving together does not prove one causes the other","Causation is impossible","Data are useless"],1,"A third factor may explain both.");
  o(M,"Arrange the stages of a statistical survey.",["Define objectives","Design the questionnaire and sample","Pilot test","Fieldwork (data collection)","Data processing and analysis","Reporting and dissemination"],"Piloting catches problems before full fieldwork.");
  t(E,"The median is less affected by extreme values than the mean.",true,"It is preferred for skewed data such as incomes.");
  t(M,"A larger, properly drawn random sample generally gives more precise estimates.",true,"Standard error falls as sample size rises.");
  t(M,"Leading questions in a questionnaire improve data quality.",false,"They bias responses.");
  s(M,"Data: 3, 7, 7, 9, 14. What is the mode? (number only)",["7"],"The mode is the most frequent value.");
  m(M,"A census differs from a sample survey because it:",["Covers only a sample","Attempts to enumerate every unit in the population","Is cheaper","Has no errors"],1,"Censuses are costly but give small-area data.");
  m(M,"In linear regression y = a + bx, the coefficient b represents:",["The intercept","The change in y for a one-unit change in x","The error","The sample size"],1,"a is the intercept.");
  m(H,"Non-sampling errors include:",["Only random sampling variation","Errors from non-response, poor questions, interviewer bias and processing mistakes","Only large samples","None"],1,"They can occur even in a census.");

  /* ---------------- Economic Planning ---------------- */
  cadre("Economic Planning Cadre");
  m(M,"Real GDP differs from nominal GDP because it:",["Includes imports only","Is adjusted for inflation","Excludes services","Is measured in dollars"],1,"Real GDP reflects changes in output volume.");
  m(M,"If the marginal propensity to consume (MPC) is 0.8, the simple expenditure multiplier is:",["0.8","1.25","5","8"],2,"Multiplier = 1 ÷ (1 − MPC) = 1 ÷ 0.2 = 5.");
  m(M,"The Internal Rate of Return (IRR) of a project is the discount rate at which:",["NPV is maximised","NPV equals zero","Costs are zero","Benefits double"],1,"Projects are accepted if IRR exceeds the cost of capital.");
  m(M,"Opportunity cost is:",["The money price of a good","The value of the next best alternative forgone","A sunk cost","A tax"],1,"Every allocation decision has an opportunity cost.");
  m(M,"Monetary policy in Nigeria is conducted by the:",["Ministry of Finance","Central Bank of Nigeria","National Assembly","State governments"],1,"Fiscal policy (taxes and spending) is set by governments.");
  m(M,"A Gini coefficient of 0 indicates:",["Perfect inequality","Perfect equality of income","High poverty","No data"],1,"1 (or 100) indicates maximum inequality.");
  m(M,"The Sustainable Development Goals consist of:",["8 goals by 2015","17 goals to be achieved by 2030","10 goals by 2050","5 goals"],1,"They succeeded the Millennium Development Goals.");
  m(M,"Public goods are:",["Rival and excludable","Non-rival and non-excludable","Always produced by firms","Luxury goods"],1,"E.g. street lighting and national defence.");
  m(M,"Price elasticity of demand of −2 means that a 10% price increase reduces quantity demanded by:",["2%","5%","10%","20%"],3,"%ΔQ = −2 × 10% = −20%: demand is elastic.");
  m(M,"Comparative advantage means a country should specialise in goods it can produce at:",["The highest cost","A lower opportunity cost than other countries","Any cost","No cost"],1,"Specialisation and trade raise total output.");
  m(M,"Nigeria's National Development Plan covering 2021–2025 succeeded the:",["Vision 2010","Economic Recovery and Growth Plan (2017–2020)","SAP","NEEDS 2004"],1,"Lagos has its own Lagos State Development Plan 2052.");
  m(M,"A logical framework (logframe) matrix sets out a project's:",["Staff salaries","Goal, purpose, outputs and activities with indicators, means of verification and assumptions","Building designs","Tax rates"],1,"It supports planning, monitoring and evaluation.");
  o(M,"Arrange the stages of the project cycle.",["Identification","Preparation and appraisal","Approval and financing","Implementation","Monitoring","Evaluation"],"Lessons from evaluation inform new projects.");
  t(E,"GDP per capita is GDP divided by population.",true,"It is a rough measure of average income.");
  t(M,"A budget deficit occurs when government revenue exceeds expenditure.",false,"A deficit occurs when spending exceeds revenue.");
  t(M,"Cost-benefit analysis compares the discounted costs and benefits of a project to society.",true,"It guides public investment decisions.");
  s(M,"If MPC is 0.75, what is the expenditure multiplier? (number only)",["4"],"1 ÷ (1 − 0.75) = 4.");
  m(H,"Stagflation describes a situation of:",["High growth and low inflation","High inflation combined with stagnant growth and high unemployment","Falling prices and boom","Balanced budget"],1,"It challenges conventional demand-management policy.");
  m(M,"The balance of payments records:",["Only government budgets","A country's transactions with the rest of the world","Bank balances","Tax receipts"],1,"It includes the current, capital and financial accounts.");
  m(M,"An economic planner forecasting state revenue should mainly consider:",["Only last year's figure","Economic growth, tax base, policy changes, oil prices/transfers and collection efficiency","The weather only","The Governor's preferences only"],1,"Realistic revenue forecasts underpin credible budgets.");

  /* ---------------- Research ---------------- */
  cadre("Research Cadre");
  o(M,"Arrange the stages of the research process.",["Identify the research problem","Review the literature","Formulate questions or hypotheses","Design the methodology","Collect data","Analyse and interpret data","Report findings"],"Each stage builds on the previous one.");
  m(M,"The null hypothesis usually states that:",["There is an effect","There is no effect or no difference","The researcher is right","Data are missing"],1,"Research tests whether evidence allows it to be rejected.");
  m(M,"Validity refers to whether a research instrument:",["Gives consistent results","Measures what it is intended to measure","Is cheap","Is long"],1,"Reliability refers to consistency.");
  m(M,"Reliability refers to:",["Accuracy of measuring the right concept","Consistency of results when measurement is repeated","Speed of data collection","Sample size"],1,"A reliable instrument may still be invalid.");
  m(M,"Qualitative research is best suited to:",["Measuring averages","Exploring meanings, experiences and reasons in depth","Large-scale statistical tests","Calculating GDP"],1,"Quantitative research measures and counts.");
  m(M,"In an experiment testing whether training affects productivity, productivity is the:",["Independent variable","Dependent variable","Control variable","Confounder"],1,"Training is the independent variable.");
  m(M,"Data collected first-hand by the researcher through surveys or interviews are:",["Secondary data","Primary data","Meta-data","Big data"],1,"Secondary data were collected by others.");
  m(M,"Triangulation in research means:",["Using three researchers only","Using multiple data sources or methods to cross-check findings","Drawing triangles","A sampling method"],1,"It strengthens credibility.");
  m(M,"A pilot study is conducted to:",["Replace the main study","Test the instruments and procedures before the main study","Publish results early","Save money only"],1,"It reveals problems early.");
  m(M,"A focus group discussion typically involves:",["One respondent","A small group (about 6–10) discussing a topic guided by a moderator","Thousands of people","A questionnaire only"],1,"It is a qualitative method.");
  m(M,"A Likert scale measures:",["Height","Attitudes, e.g. strongly agree to strongly disagree","Income only","Temperature"],1,"It is common in surveys.");
  m(M,"Before collecting data from human participants, researchers should obtain:",["Nothing","Informed consent and, where required, ethical approval","Payment from participants","Permission from the media"],1,"Ethics committees review research involving people.");
  m(M,"Plagiarism is:",["Citing sources correctly","Presenting another person's work or ideas as one's own without acknowledgement","Doing original research","Using statistics"],1,"Proper referencing avoids plagiarism.");
  x(M,"Match each research design to its description.",[["Case study","In-depth study of one or a few cases"],["Cross-sectional survey","Data collected at one point in time"],["Longitudinal study","Same subjects followed over time"],["Experiment","Researcher manipulates a variable and observes effects"]],"Design choice depends on the research question.");
  t(E,"A literature review helps identify what is already known and the gaps a study can fill.",true,"It situates the research.");
  t(M,"Participants' identities in research should be kept confidential unless they agree otherwise.",true,"Confidentiality is a core ethical principle.");
  t(M,"A study with a biased sample can still be generalised to the whole population without limitations.",false,"Sampling bias limits generalisation.");
  s(E,"What is the name for a research participant's agreement after understanding the study? (two words)",["informed consent"],"Consent must be voluntary and informed.");
  m(H,"Action research is characterised by:",["Laboratory experiments only","Practitioners researching their own practice in cycles of planning, acting, observing and reflecting","Purely theoretical work","Only secondary data"],1,"It is common in education and public administration.");
  m(M,"A policy research report for decision-makers should begin with:",["The raw data","An executive summary of key findings and recommendations","The bibliography","The questionnaire"],1,"Busy readers need the key messages first.");

  /* ---------------- Social Welfare ---------------- */
  cadre("Social Welfare Cadre");
  m(M,"Under the Child's Rights Act 2003 (and the Lagos Child's Rights Law), a child is a person below the age of:",["12","16","18","21"],2,"Lagos domesticated the Act in 2007.");
  m(M,"Lagos State's main law against domestic violence was enacted in:",["1999","2007","2015","2023"],1,"The Protection Against Domestic Violence Law 2007.");
  m(M,"The federal Violence Against Persons (Prohibition) Act was enacted in:",["2003","2010","2015","2020"],2,"It criminalises many forms of violence, including harmful traditional practices.");
  o(M,"Arrange the stages of the social casework process.",["Intake and engagement","Assessment","Planning","Intervention","Evaluation","Termination and follow-up"],"Casework is client-centred and goal-directed.");
  m(M,"The social work principle of 'client self-determination' means:",["The worker decides everything","Clients have the right to make their own choices, within the law","Clients must obey","Families decide for clients"],1,"Workers support informed choice.");
  m(M,"Foster care differs from adoption mainly because foster care:",["Is permanent","Is usually temporary, while adoption permanently transfers parental rights","Requires no assessment","Is only for adults"],1,"Both require proper assessment and court/agency processes.");
  m(M,"The Lagos agency responsible for the welfare and inclusion of persons with disabilities is:",["LASODA (Lagos State Office of Disability Affairs)","LASTMA","LIRS","LAWMA"],0,"Established under the Lagos Special People's Law 2011.");
  m(M,"The federal law prohibiting discrimination against persons with disabilities was enacted in:",["2011","2018","2007","1999"],1,"The Discrimination Against Persons with Disabilities (Prohibition) Act 2018.");
  m(M,"Lagos State's Domestic and Sexual Violence Agency (formerly the Response Team) mainly:",["Collects taxes","Coordinates response and support services for survivors of domestic and sexual violence","Runs schools","Licenses vehicles"],1,"It links survivors to medical, legal and psychosocial support.");
  m(M,"Social workers who suspect child abuse should:",["Ignore it to avoid trouble","Act promptly in line with child protection procedures, including reporting to the appropriate authority","Confront the abuser alone","Tell neighbours"],1,"Child safety comes first.");
  m(M,"A case conference brings together:",["Only lawyers","Professionals and, where appropriate, the family to plan support for a client","Only the client","Journalists"],1,"Multi-agency planning improves outcomes.");
  m(M,"Conditional cash transfers are a form of:",["Taxation","Social protection that pays poor households if they meet conditions such as school attendance","Loans","Fines"],1,"They aim to reduce poverty and build human capital.");
  x(M,"Match each social work value to its meaning.",[["Confidentiality","Protecting client information"],["Non-judgemental attitude","Accepting clients without condemnation"],["Individualisation","Treating each client as unique"],["Self-determination","Respecting clients' right to choose"]],"Core values of social work practice.");
  t(E,"Remand homes and approved schools form part of the juvenile justice and child welfare system.",true,"They care for children in conflict with the law.");
  t(M,"Social workers may share clients' case information freely on social media to raise awareness.",false,"This breaches confidentiality.");
  t(M,"Psychosocial support helps people cope with trauma and stress.",true,"It is part of comprehensive care for survivors.");
  s(M,"Under the Child's Rights Act, below what age is a person a child? (number only)",["18"],"Persons under 18 are children.");
  m(M,"The best interest of the child principle requires that:",["Parents' wishes always prevail","The child's welfare is the primary consideration in all decisions concerning the child","Courts decide quickly","Children decide alone"],1,"It is central to child protection law.");
  m(H,"In working with an elderly person who lives alone and is neglecting self-care, the social worker should first:",["Force institutionalisation","Assess needs, capacity and wishes, and mobilise family and community support","Ignore it","Take their property"],1,"Least restrictive, person-centred options come first.");
  m(M,"Rehabilitation of street children typically involves:",["Arrest only","Rescue, temporary shelter, family tracing and reunification or alternative care, and education/skills","Sending them away","Ignoring them"],1,"Reintegration is the goal.");

  /* ---------------- Community Development ---------------- */
  cadre("Community Development Cadre");
  m(M,"A core principle of community development is:",["Imposing projects from outside","Community participation and self-help based on felt needs","Paying communities to accept projects","Avoiding local leaders"],1,"Ownership improves sustainability.");
  m(M,"In Lagos, Community Development Associations (CDAs) are coordinated at LGA/LCDA level by:",["Community Development Committees (CDCs)","LASTMA","LAWMA","Police"],0,"CDAs link communities with government.");
  m(M,"Participatory Rural Appraisal (PRA) tools include:",["Tax forms","Transect walks, seasonal calendars and resource mapping","Court orders","Bank loans"],1,"They let communities analyse their own situations.");
  m(M,"Asset-based community development (ABCD) starts by:",["Listing community problems only","Identifying and mobilising existing community strengths and resources","Seeking donor funds first","Ignoring local groups"],1,"It contrasts with needs-based approaches.");
  m(M,"On Arnstein's 'ladder of citizen participation', the highest rung is:",["Manipulation","Consultation","Citizen control","Informing"],2,"Manipulation and therapy are non-participation.");
  m(M,"A 'felt need' is:",["A need identified only by experts","A need the community itself recognises and expresses","A government target","A donor priority"],1,"Projects based on felt needs attract participation.");
  m(M,"Counterpart funding in community projects means:",["Communities pay nothing","Communities contribute cash, labour or materials alongside government or donor funds","Funds are borrowed","Funds are returned"],1,"It builds commitment.");
  m(M,"A cooperative society is:",["A government agency","An autonomous association of people who pool resources for mutual economic benefit","A political party","A bank branch only"],1,"Cooperatives support savings, credit and marketing.");
  m(M,"Sustainability of a community project depends most on:",["Media coverage","Community ownership, maintenance arrangements and local capacity","A big launch","Imported materials"],1,"Many projects fail when no one maintains them.");
  m(M,"Gender mainstreaming in community development means:",["Excluding men","Considering the needs and roles of women and men at every stage of a project","Hiring only women","Ignoring gender"],1,"It promotes equitable benefits.");
  m(M,"A community needs assessment is used to:",["Collect taxes","Identify, prioritise and document community needs and resources","Approve buildings","Elect leaders"],1,"It guides planning.");
  m(M,"Conflict between two communities over a project site is best handled by:",["Force","Dialogue, mediation and involving traditional and community leaders","Cancelling all projects","Choosing one side"],1,"Peaceful resolution protects relationships.");
  x(M,"Match each PRA tool to its purpose.",[["Transect walk","Observing land use and resources across the community"],["Seasonal calendar","Showing activities and problems through the year"],["Resource map","Locating community resources and facilities"],["Venn diagram","Showing relationships with institutions"]],"Tools for participatory analysis.");
  o(M,"Arrange the stages of a community development project.",["Community entry and mobilisation","Needs assessment","Prioritisation and planning","Implementation with community participation","Monitoring and evaluation","Handover and sustainability"],"Participation runs through all stages.");
  t(E,"Self-help projects encourage communities to use their own resources to solve problems.",true,"Government often supports with matching resources.");
  t(M,"Community leaders should be bypassed to speed up projects.",false,"Engaging leaders builds legitimacy and cooperation.");
  t(M,"Monitoring helps detect problems during implementation so they can be corrected.",true,"Evaluation assesses results after or at key points.");
  s(E,"What does 'CDA' stand for in community development? (three words)",["community development association","community development associations"],"CDAs are registered community groups.");
  m(H,"A borehole provided to a community breaks down within a year because no one was trained to maintain it. This mainly reflects failure of:",["The weather","Sustainability planning and community capacity building","Engineering only","The water table only"],1,"Maintenance committees and training are essential.");
  m(M,"Community mobilisation involves:",["Ignoring residents","Raising awareness and motivating community members to participate in development","Collecting levies by force","Political campaigns only"],1,"It builds participation.");

  /* ---------------- Accountant (graduate) ---------------- */
  cadre("Accountant Cadre (graduate)");
  m(M,"The two statutory professional accountancy bodies in Nigeria are:",["ICAN and ANAN","NBA and NMA","COREN and ARCON","NIM and CIPM"],0,"The Institute of Chartered Accountants of Nigeria and the Association of National Accountants of Nigeria.");
  m(M,"The regulator responsible for accounting and financial reporting standards in Nigeria is the:",["FRCN (Financial Reporting Council of Nigeria)","CBN","SEC only","FIRS"],0,"FRCN adopted IFRS and IPSAS for Nigeria.");
  m(M,"The public sector in Nigeria has adopted:",["US GAAP","IPSAS (International Public Sector Accounting Standards)","No standards","Tax rules only"],1,"Accrual-basis IPSAS replaced cash-basis reporting.");
  x(M,"Match each cash flow to its category.",[["Salaries paid","Operating activities"],["Purchase of a vehicle","Investing activities"],["Proceeds of a loan","Financing activities"],["Fees received for services","Operating activities"]],"Statement of cash flows classification.");
  m(M,"The going-concern assumption means that:",["The entity will close soon","The entity is expected to continue operating for the foreseeable future","Assets are valued at scrap","Debts are ignored"],1,"It underlies normal valuation of assets and liabilities.");
  m(M,"An asset costing ₦1,000,000 is depreciated at 20% a year on the reducing-balance method. Depreciation in year 2 is:",["₦200,000","₦160,000","₦128,000","₦100,000"],1,"Year 1: 200,000 (NBV 800,000). Year 2: 20% × 800,000 = 160,000.");
  m(M,"Current assets of ₦6m and current liabilities of ₦4m give a current ratio of:",["0.67","1.5","2.0","24"],1,"6 ÷ 4 = 1.5.");
  m(M,"An expense incurred but not yet paid at the reporting date is recorded as:",["A prepayment (asset)","An accrual (liability)","Revenue","Equity"],1,"Accrual accounting matches expenses to periods.");
  m(M,"A favourable budget variance on expenditure means:",["Actual spending exceeded budget","Actual spending was below budget","Revenue fell","The budget was wrong"],1,"Variances must be investigated, not just reported.");
  m(M,"The fundamental principles of professional ethics for accountants include:",["Integrity, objectivity, professional competence and due care, confidentiality and professional behaviour","Speed, profit and loyalty","Secrecy and silence","Popularity"],0,"From the IESBA Code adopted by ICAN.");
  m(M,"A Treasury Single Account improves public finance mainly by:",["Hiding balances","Consolidating government cash for visibility, control and better cash management","Increasing bank charges","Removing budgets"],1,"Idle balances in commercial banks are eliminated.");
  m(M,"An Integrated Financial Management Information System (IFMIS) mainly:",["Replaces accountants","Automates budgeting, accounting and reporting in one integrated system","Prints receipts only","Pays contractors in cash"],1,"It improves control and timeliness of reports.");
  o(M,"Arrange the stages of the accounting cycle.",["Identify and record transactions in books of prime entry","Post to the ledger","Prepare a trial balance","Make adjustments (accruals, depreciation)","Prepare financial statements","Close the books"],"The cycle repeats each period.");
  t(E,"Under accrual accounting, revenue is recognised when earned, not necessarily when cash is received.",true,"This gives a truer picture of performance.");
  t(M,"The statement of financial position shows revenue and expenses for a period.",false,"It shows assets, liabilities and net assets at a date; performance is in the statement of financial performance.");
  t(M,"Bank reconciliations should be prepared regularly, at least monthly.",true,"They detect errors and fraud early.");
  s(M,"Current assets are ₦9m and current liabilities ₦6m. What is the current ratio? (number only)",["1.5"],"9 ÷ 6 = 1.5.");
  m(H,"Under IPSAS, property, plant and equipment is initially measured at:",["Market value always","Cost","Zero","Insured value"],1,"Subsequent measurement may use the cost or revaluation model.");
  m(M,"The Consolidated Revenue Fund of a State is:",["A private account","The fund into which all State revenues are paid, except where the law provides otherwise","A pension fund","A loan account"],1,"Withdrawals require appropriation.");
  m(M,"Prudence (conservatism) in accounting means:",["Overstating assets","Exercising caution so that assets and income are not overstated and liabilities and expenses not understated","Ignoring risks","Delaying all reporting"],1,"It tempers optimistic estimates.");

  /* ---------------- Internal Audit ---------------- */
  cadre("Internal Audit Cadre");
  m(M,"The IIA defines internal auditing as an independent, objective assurance and consulting activity designed to:",["Replace management","Add value and improve an organisation's operations","Prepare budgets","Approve payments"],1,"It evaluates governance, risk management and control.");
  m(M,"In the Three Lines Model, internal audit is the:",["First line","Second line","Third line","Fourth line"],2,"Management is the first line; risk and compliance functions the second.");
  o(M,"Arrange the five components of the COSO internal control framework.",["Control environment","Risk assessment","Control activities","Information and communication","Monitoring activities"],"All five must be present and functioning.");
  m(M,"Risk-based audit planning means:",["Auditing everything equally","Focusing audit resources on areas with the highest risk","Auditing only cash","Auditing at random"],1,"It makes best use of limited resources.");
  m(M,"An internal audit charter defines:",["Salaries","The purpose, authority and responsibility of internal audit","Building layout","Audit fees"],1,"It is approved by the board or audit committee.");
  m(M,"Computer-Assisted Audit Techniques (CAATs) are used to:",["Type reports","Analyse large volumes of data electronically, e.g. to find duplicates and anomalies","Replace auditors","Print vouchers"],1,"They allow testing of whole populations.");
  x(M,"Match each element of an audit finding to its meaning.",[["Criteria","What should be (standard or rule)"],["Condition","What actually is"],["Cause","Why the gap occurred"],["Effect","The impact or risk of the gap"]],"Plus a recommendation to fix the cause.");
  m(M,"Inherent risk is:",["Risk after controls","The risk before considering controls","Risk the auditor fails to detect","No risk"],1,"Control risk and detection risk complete the audit risk model.");
  m(M,"Benford's Law is used in audit analytics to:",["Calculate tax","Detect unusual digit patterns that may indicate manipulated data","Sample randomly","Count stock"],1,"Naturally occurring numbers follow predictable leading-digit frequencies.");
  m(M,"An audit committee mainly:",["Runs operations","Oversees financial reporting, internal control and the audit functions","Approves all payments","Recruits all staff"],1,"It strengthens independence.");
  m(M,"Internal auditors maintain objectivity by:",["Auditing areas they recently managed","Avoiding conflicts of interest and not auditing their own work","Taking gifts from auditees","Agreeing with management always"],1,"Objectivity is an IIA core principle.");
  m(M,"Follow-up audits are carried out to:",["Repeat the full audit","Confirm whether agreed recommendations have been implemented","Punish staff","Close the unit"],1,"Without follow-up, findings may never be fixed.");
  m(M,"A red flag for payroll fraud is:",["Staff on leave","Several employees sharing the same bank account number","Annual increments","Retirements"],1,"It may indicate ghost workers.");
  t(E,"Internal auditors should report functionally to the audit committee and administratively to the Accounting Officer.",true,"This dual reporting protects independence.");
  t(M,"Internal auditors should design and operate the controls they audit.",false,"That would impair objectivity.");
  t(M,"Statistical sampling allows the auditor to quantify sampling risk.",true,"Non-statistical sampling relies on judgement.");
  s(M,"In the Three Lines Model, which line is internal audit? (one word)",["third","3rd","3","three"],"It provides independent assurance.");
  m(H,"Detection risk is reduced by:",["Doing less testing","Performing more extensive or more effective substantive procedures","Ignoring controls","Using smaller samples"],1,"Auditors adjust procedures to keep overall audit risk acceptable.");
  m(M,"The best evidence that an asset exists is usually:",["A verbal assurance","Physical inspection by the auditor","An email","An old invoice"],1,"Direct evidence obtained by the auditor is most reliable.");
  m(M,"Continuous auditing means:",["Auditing once every five years","Ongoing, often automated, testing of transactions and controls","No audits","Only annual audits"],1,"It enables early detection of problems.");

  /* ---------------- Procurement ---------------- */
  cadre("Procurement Cadre");
  m(M,"Public procurement by Lagos State MDAs is governed principally by the:",["Federal Public Procurement Act only","Lagos State Public Procurement Law, administered by the Lagos State Public Procurement Agency","Companies Act","Tenancy Law"],1,"The Agency sets thresholds and issues No Objection.");
  x(M,"Match each procurement method to when it is typically used.",[["Open competitive bidding","Default method for most procurements"],["Request for quotations","Low-value, readily available goods"],["Direct procurement","Only one supplier exists or in justified urgent cases"],["Two-stage tendering","Complex requirements needing technical clarification first"]],"Non-default methods require justification.");
  m(M,"A bid security is required to:",["Pay the contractor in advance","Protect the procuring entity if a bidder withdraws its bid or fails to sign the contract","Guarantee quality after delivery","Pay taxes"],1,"It is returned to unsuccessful bidders.");
  m(M,"A performance bond protects the procuring entity against:",["Bid withdrawal","Failure by the contractor to perform the contract","Exchange rate changes","Late bid opening"],1,"It is provided by the winning bidder before contract signing.");
  m(M,"A bid security of 2% on a ₦50m bid amounts to:",["₦100,000","₦1,000,000","₦2,500,000","₦500,000"],1,"2% of 50m = ₦1m.");
  m(M,"Contracts are usually awarded to the:",["Cheapest bid regardless of compliance","Lowest evaluated responsive bid","Bidder with the biggest office","First bid received"],1,"Bids must meet the requirements before price is compared.");
  m(M,"A procurement plan should be prepared:",["After contracts are awarded","At the start of the year, linked to the approved budget","Only when audited","By contractors"],1,"It sequences procurement and avoids splitting.");
  m(M,"An officer whose relative owns a bidding company should:",["Evaluate the bid","Declare the conflict of interest and withdraw from the process","Hide the relationship","Award the contract"],1,"Undeclared conflicts are serious misconduct.");
  m(M,"An advance payment guarantee is required when:",["The contractor is paid in advance, to secure repayment if they default","Bids are opened","A contract ends","A supplier complains"],0,"Advances should be secured.");
  m(M,"Procurement records should be kept to:",["Fill cabinets","Provide an audit trail of every decision for accountability and review","Delay payments","Impress visitors"],1,"Records support audits and complaints review.");
  m(M,"A bidder who believes the process was unfair can:",["Do nothing","Submit a complaint for administrative review under the procurement law","Bribe officials","Go to the press only"],1,"Complaint and review mechanisms protect fairness.");
  m(M,"E-procurement mainly improves:",["Secrecy","Transparency, efficiency and access for bidders","Paper use","Contract splitting"],1,"It reduces opportunities for manipulation.");
  o(M,"Arrange the stages of the procurement cycle.",["Needs identification and planning","Preparation of specifications and bidding documents","Advertisement and bid submission","Bid opening and evaluation","Approval and contract award","Contract management and closure"],"Contract management ensures value is delivered.");
  t(E,"Splitting a contract into smaller lots to avoid approval thresholds is prohibited.",true,"It is a breach of procurement law.");
  t(M,"Bids received after the deadline should be accepted if the bidder has a good excuse.",false,"Late bids are returned unopened.");
  t(M,"Value for money considers the whole-life cost and quality, not just the purchase price.",true,"The cheapest option may be costlier over time.");
  s(M,"What is the name of the guarantee a winning contractor provides to secure proper performance? (two words)",["performance bond","performance security","performance guarantee"],"Usually a percentage of the contract value.");
  m(H,"During evaluation, a bid contains an arithmetic error where the unit rate × quantity does not equal the line total. Usually:",["The bid is disqualified automatically","The error is corrected in line with the bidding documents (often the unit rate prevails) and the bidder is asked to accept","The total is accepted","The evaluator chooses whichever is lower"],1,"Bidding documents set rules for correcting arithmetic errors.");
  m(M,"Contract variations should be:",["Agreed verbally","Justified, approved by the appropriate authority and documented","Avoided by changing the contract quietly","Paid without approval"],1,"Uncontrolled variations inflate costs.");
  m(M,"The standstill period after notifying the intended award allows:",["Faster payment","Unsuccessful bidders time to raise complaints before the contract is signed","The contractor to start work","Re-advertisement"],1,"It supports fairness and accountability.");

  /* ---------------- Information (graduate) ---------------- */
  cadre("Information Cadre");
  x(M,"Match each media theory to its main idea.",[["Agenda-setting","Media influence what issues people think about"],["Two-step flow","Media messages reach people through opinion leaders"],["Gatekeeping","Editors decide which stories get through"],["Uses and gratifications","Audiences actively choose media to meet their needs"]],"Theories that inform government communication strategy.");
  m(M,"Agenda-setting theory is associated with:",["McCombs and Shaw","Marx and Engels","Maslow","Lewin"],0,"Their 1968 Chapel Hill study.");
  m(M,"The 'spiral of silence' theory suggests that people:",["Always speak openly","Stay silent when they believe their views are in the minority","Ignore the media","Prefer radio"],1,"Proposed by Noelle-Neumann.");
  m(M,"Misinformation differs from disinformation because misinformation is:",["Deliberately false","False information shared without intent to deceive","Always true","Official information"],1,"Disinformation is deliberately false.");
  m(M,"Nigeria's Cybercrimes (Prohibition, Prevention, etc.) Act was enacted in:",["2007","2015","2020","2023"],1,"It was amended in 2024.");
  m(M,"The main purpose of a government communication strategy is to:",["Silence critics","Inform citizens, explain policies and build understanding and trust through planned messages","Advertise products","Replace the press"],1,"Strategy defines objectives, audiences, messages and channels.");
  m(M,"Fact-checking before publication is essential mainly to:",["Delay news","Ensure accuracy and protect credibility","Satisfy lawyers only","Shorten stories"],1,"Errors damage public trust.");
  m(M,"An editorial expresses:",["A news report","The opinion of the publication on an issue","An advertisement","A photo caption"],1,"Editorials are distinct from news reporting.");
  m(M,"Audience research helps an information officer to:",["Write longer stories","Understand target audiences' needs, media habits and perceptions","Avoid all media","Increase costs"],1,"Messages should be tailored to audiences.");
  m(M,"The Lagos State Ministry responsible for government information and public communication is the Ministry of:",["Information and Strategy","Works","Health","Transport"],0,"It coordinates government communication.");
  m(M,"In crisis communication, the information officer should:",["Speculate","Be first, be right and be credible with timely, accurate updates","Blame the media","Stay silent for weeks"],1,"Silence allows rumours to dominate.");
  m(M,"Propaganda differs from public information mainly because propaganda:",["Is always true","Uses selective or misleading messages mainly to manipulate opinion","Is two-way","Is unbiased"],1,"Government information should be factual and transparent.");
  m(M,"A media kit for a launch typically contains:",["Only a photo","Press release, fact sheet, backgrounder, photos and contacts","Contracts","Salary details"],1,"It equips journalists with accurate information.");
  o(M,"Arrange the steps in planning a public enlightenment campaign.",["Research the issue and audience","Set objectives","Develop key messages","Choose channels and materials","Implement the campaign","Evaluate impact"],"Evaluation shows whether behaviour or awareness changed.");
  t(E,"Social media monitoring helps detect rumours and public concerns early.",true,"Early detection allows timely response.");
  t(M,"Government information officers should publish unverified claims if they are popular.",false,"Accuracy comes before speed or popularity.");
  t(M,"Two-way communication involves listening to feedback from the public, not only sending messages.",true,"Feedback improves policies and communication.");
  s(M,"What term describes false information deliberately created to deceive?",["disinformation"],"Misinformation lacks deliberate intent.");
  m(H,"Under the Freedom of Information Act 2011, a public institution must generally respond to a request within:",["24 hours","7 days","30 days","90 days"],1,"An extension of up to 7 days may be allowed in certain cases.");
  m(M,"An effective press briefing by a government spokesperson requires:",["Avoiding all questions","Clear key messages, accurate facts and preparation for likely questions","Reading a long document","Arguing with journalists"],1,"Preparation builds credibility.");

  /* ---------------- Public Relations ---------------- */
  cadre("Public Relations Cadre");
  m(M,"The statutory body that regulates public relations practice in Nigeria is the:",["NBC","NIPR (Nigerian Institute of Public Relations)","APCON","NUJ"],1,"Established by Decree No. 16 of 1990.");
  m(M,"Public relations is best defined as:",["Advertising only","The deliberate, planned and sustained effort to establish and maintain mutual understanding between an organisation and its publics","Selling products","Writing press releases only"],1,"PR is about relationships and reputation.");
  o(M,"Arrange the stages of the RACE model of public relations.",["Research","Action (planning)","Communication","Evaluation"],"A systematic approach to PR programmes.");
  m(M,"In Grunig's four models of PR, the ideal model based on dialogue and mutual adjustment is:",["Press agentry","Public information","Two-way asymmetric","Two-way symmetric"],3,"It seeks mutual understanding rather than persuasion only.");
  m(M,"'Publics' in PR refers to:",["Only the general public","Groups of people with an interest in or impact on the organisation","Shareholders only","Journalists only"],1,"Internal and external publics need different approaches.");
  m(M,"Advertising value equivalency (AVE) is criticised as a PR measure because it:",["Is too accurate","Does not measure outcomes such as changes in awareness, attitudes or behaviour","Is required by law","Measures only social media"],1,"The Barcelona Principles reject AVEs.");
  m(M,"Internal communication in a Ministry mainly aims to:",["Inform only the press","Keep staff informed, engaged and aligned with organisational goals","Advertise","Replace management"],1,"Staff are important ambassadors.");
  m(M,"Corporate social responsibility (CSR) refers to:",["Profit only","An organisation's commitment to ethical conduct and contributing to society and the environment","Tax evasion","Marketing only"],1,"CSR supports reputation and stakeholder trust.");
  m(M,"Corporate identity includes:",["Only the logo","Visual and behavioural elements such as logo, colours, values and conduct that express who the organisation is","Salaries","Buildings only"],1,"Consistency builds recognition.");
  m(M,"A reputation crisis is best managed by:",["Denial","Acknowledging the issue, taking responsibility where appropriate, acting and communicating openly","Attacking critics","Deleting accounts"],1,"Transparency helps rebuild trust.");
  m(M,"Sponsorship as a PR tool mainly helps to:",["Pay staff","Associate the organisation with valued causes or events to build goodwill","Collect taxes","Hide information"],1,"Choose sponsorships aligned with organisational values.");
  m(M,"A PR officer organising an official event must pay particular attention to:",["Personal benefits","Protocol, invitations, logistics, media arrangements and contingency plans","Only food","Only music"],1,"Good events need detailed planning.");
  x(M,"Match each PR tool to its purpose.",[["Press release","Announces news to the media"],["Feature article","Tells an in-depth story"],["Newsletter","Regular communication with stakeholders"],["Open day","Invites the public to see the organisation's work"]],"Tools are chosen to suit audiences and goals.");
  t(E,"Research is the first step in planning a PR programme.",true,"It identifies problems, publics and opportunities.");
  t(M,"PR and propaganda are the same thing.",false,"Ethical PR is truthful and two-way; propaganda manipulates.");
  t(M,"Evaluation should measure outcomes, not just outputs such as the number of press releases.",true,"Outcomes show real impact.");
  s(E,"What does 'NIPR' stand for? (five words)",["nigerian institute of public relations"],"It regulates PR practice in Nigeria.");
  m(H,"An organisation receives negative social media comments about delays in service. The best PR response is to:",["Delete the comments","Respond promptly and politely, acknowledge the issue, explain actions being taken and follow up","Block users","Ignore them"],1,"Responsiveness can turn critics into supporters.");
  m(M,"Stakeholder mapping helps PR practitioners to:",["Avoid all stakeholders","Prioritise stakeholders by influence and interest and plan engagement","Draw maps of roads","Hire staff"],1,"It focuses effort where it matters most.");
  m(M,"Media relations in PR involves:",["Bribing journalists","Building honest, professional relationships with journalists and providing accurate information","Avoiding the media","Controlling editorial decisions"],1,"Credibility is the foundation of media relations.");

  /* ---------------- Printing ---------------- */
  cadre("Printing Cadre");
  m(M,"Offset lithography works on the principle that:",["Metal repels ink","Oil (ink) and water do not mix","Paper absorbs all colours","Heat transfers images"],1,"Image areas attract ink; non-image areas attract water.");
  m(E,"The four process colours used in full-colour printing are:",["RGB","CMYK (Cyan, Magenta, Yellow, Key/Black)","Red, Green, Blue, White","Pantone only"],1,"RGB is used for screens.");
  m(E,"The size of an A4 sheet is:",["148 × 210 mm","210 × 297 mm","297 × 420 mm","216 × 279 mm"],1,"A3 (297 × 420 mm) is twice A4.");
  m(M,"Paper weight is commonly expressed in:",["Litres","GSM (grams per square metre)","Kilowatts","Centimetres"],1,"Higher GSM means heavier, thicker paper.");
  m(M,"For good-quality print, images are usually prepared at a resolution of about:",["72 dpi","150 dpi","300 dpi","1,200 dpi"],2,"72 dpi is typical for screen display.");
  m(M,"'Bleed' in print design is:",["Ink spilling","Extending images or colour beyond the trim line (usually about 3 mm) so no white edges remain after cutting","A paper type","A binding method"],1,"It allows for trimming tolerances.");
  x(M,"Match each binding method to its typical use.",[["Saddle stitching","Thin booklets and magazines (staples on the fold)"],["Perfect binding","Paperback books with glued spines"],["Spiral (coil) binding","Manuals that lie flat"],["Case binding","Hardback books"]],"Binding depends on page count and use.");
  m(M,"Imposition in printing refers to:",["Charging extra","Arranging pages on a printing sheet so they appear in the correct order after folding and cutting","Proofreading","Mixing ink"],1,"Correct imposition is essential for booklets.");
  m(M,"Computer-to-plate (CTP) technology:",["Uses film negatives","Images printing plates directly from digital files","Prints on screens","Replaces paper"],1,"CTP improves quality and speed.");
  m(E,"A ream of paper contains:",["100 sheets","250 sheets","500 sheets","1,000 sheets"],2,"Paper stock is usually ordered by the ream.");
  m(M,"Registration marks on a print sheet are used to:",["Show the price","Align the different colour plates accurately","Mark the customer","Count sheets"],1,"Mis-registration causes blurred colour edges.");
  m(M,"Pantone (spot) colours are used when:",["Any colour will do","An exact, consistent brand colour is required","Printing in black only","Printing photos only"],1,"Spot colours are pre-mixed inks.");
  m(M,"Gravure printing is an example of:",["Relief printing","Intaglio printing (image recessed in the plate)","Planographic printing","Screen printing"],1,"Letterpress is relief; lithography is planographic.");
  m(M,"The Lagos State Government Printer is responsible for printing:",["Private novels","Official publications such as the Official Gazette, laws and government documents","Newspapers","Currency"],1,"Security and accuracy are essential.");
  o(M,"Arrange the stages of a print job.",["Receive job brief and artwork","Pre-press (proofing, imposition, plate making)","Obtain client approval of proof","Printing","Finishing (cutting, folding, binding)","Delivery"],"Proof approval prevents costly reprints.");
  t(E,"A proof should be approved before the full print run begins.",true,"Errors are cheaper to fix at proof stage.");
  t(M,"RGB colour files can be printed on an offset press without conversion with exactly the same colours.",false,"They should be converted to CMYK; colours may shift.");
  t(M,"Security printing uses features such as watermarks, microtext and special inks to prevent forgery.",true,"Used for certificates, receipts and official documents.");
  s(E,"How many sheets of paper are in a ream? (number only)",["500"],"Some specialist papers use 480 sheets, but 500 is standard.");
  m(H,"A job requires 2,000 copies of an 8-page A4 booklet printed 4 pages per side on A3 sheets (one A3 sheet carries all 8 pages). Ignoring spoilage, how many A3 sheets are needed?",["1,000","2,000","4,000","16,000"],1,"Each booklet uses one A3 sheet (4 pages per side × 2 sides), so 2,000 sheets.");

  /* ---------------- Statistics (technician) ---------------- */
  cadre("Statistics Cadre (technician)");
  m(E,"Grouping raw data into classes and counting how many fall into each produces a:",["Pie chart","Frequency table","Questionnaire","Map"],1,"It summarises data for analysis.");
  m(M,"In a survey, 45 of 180 respondents chose option A. On a pie chart, option A's angle is:",["45°","60°","90°","120°"],2,"45 ÷ 180 × 360° = 90°.");
  m(E,"The mean of 4, 6, 8 and 10 is:",["6","7","8","28"],1,"(4 + 6 + 8 + 10) ÷ 4 = 7.");
  m(M,"The median of 3, 9, 5, 11, 7 is:",["5","7","9","35"],1,"Sorted: 3, 5, 7, 9, 11 — the middle value is 7.");
  m(M,"An enumerator's main duty is to:",["Analyse data","Collect data accurately from respondents following the survey instructions","Design the sample","Write the final report"],1,"Enumerators must not alter or invent responses.");
  m(M,"An enumeration area (EA) is:",["A type of questionnaire","A small, clearly defined geographic unit assigned to an enumerator","A statistical formula","A data entry screen"],1,"EAs ensure complete coverage without overlap.");
  m(M,"Household listing before a survey is done to:",["Collect taxes","Create an up-to-date frame of households from which to select the sample","Count animals","Map roads only"],1,"A good frame reduces coverage error.");
  m(M,"Data editing involves:",["Changing answers to look better","Checking completed questionnaires for completeness, consistency and errors","Deleting data","Printing tables"],1,"Queries are resolved, not guessed.");
  m(M,"A validation rule in data entry software (e.g. CSPro) can:",["Change respondents' answers","Prevent impossible values, such as age 250, from being entered","Print questionnaires","Select samples"],1,"Validation improves data quality.");
  m(M,"Which chart is best for showing changes in a value over time?",["Pie chart","Line graph","Map","Venn diagram"],1,"Line graphs show trends clearly.");
  m(M,"A school had 400 pupils last year and 460 this year. The percentage increase is:",["6%","13%","15%","60%"],2,"(460 − 400) ÷ 400 × 100 = 15%.");
  m(M,"Coding in survey work means:",["Writing software","Assigning numerical codes to responses for processing","Encrypting files","Numbering pages"],1,"E.g. Male = 1, Female = 2.");
  x(E,"Match each chart type to its best use.",[["Bar chart","Comparing categories"],["Pie chart","Showing parts of a whole"],["Line graph","Showing trends over time"],["Histogram","Showing the distribution of continuous data"]],"Choose charts that suit the data.");
  t(E,"Respondents' answers must be kept confidential.",true,"Confidentiality encourages honest responses and is required by law.");
  t(M,"An enumerator may fill in a questionnaire on behalf of a household that refused to be interviewed.",false,"This is fabrication; non-response is recorded as such.");
  t(M,"Rounding 3.456 to two decimal places gives 3.46.",true,"The third decimal (6) rounds the second up.");
  o(E,"Arrange the stages of survey data processing.",["Receipt and checking of questionnaires","Editing and coding","Data entry","Validation and cleaning","Tabulation and analysis"],"Each stage improves data quality.");
  s(M,"In a class of 40 pupils, 12 are absent. What percentage are present? (number only)",["70","70%"],"28 ÷ 40 × 100 = 70%.");
  m(M,"The range of the data 12, 5, 19, 8, 15 is:",["7","14","19","5"],1,"Range = highest − lowest = 19 − 5 = 14.");
  m(M,"'Census night' or a reference date is used in a population census to:",["Celebrate","Count each person once at a fixed point in time","Delay counting","Count only adults"],1,"It avoids double counting and omissions.");

  /* ---------------- Youth Development ---------------- */
  cadre("Youth Development Officer Cadre");
  m(M,"Nigeria's National Youth Policy (2019) defines youth as persons aged:",["10–19","15–29","18–35","20–40"],1,"The earlier policy used 18–35.");
  m(M,"The National Youth Service Corps (NYSC) was established in:",["1960","1973","1999","2010"],1,"It promotes national unity through service by graduates.");
  m(M,"The Lagos State Employment Trust Fund (LSETF) mainly supports:",["Road building","Entrepreneurs and job seekers through loans, training and job placement","Tax collection","Water supply"],1,"It was established in 2016 to reduce unemployment.");
  m(M,"The federal agency responsible for drug law enforcement and demand reduction is the:",["NDLEA","NAFDAC only","NSCDC","FRSC"],0,"Youth officers often partner with NDLEA on drug-abuse prevention.");
  m(M,"Positive youth development focuses on:",["Treating youth only as problems","Building young people's strengths, skills and relationships","Punishment","Exclusion"],1,"Often described by the '5 Cs': competence, confidence, connection, character and caring.");
  m(M,"Peer education programmes use:",["Older officials only","Trained young people to share information and influence their peers positively","Police officers","Parents only"],1,"Peers can be credible messengers.");
  m(M,"Skills acquisition programmes for youth should be linked to:",["Political rallies","Labour market demand and access to start-up support","Random trades","Only certificates"],1,"Demand-driven skills improve employment outcomes.");
  m(M,"Mentoring helps young people mainly by:",["Giving money only","Providing guidance, role models and support for personal and career development","Replacing parents","Punishment"],1,"Structured mentoring improves outcomes.");
  m(M,"Youth participation in governance can be promoted through:",["Excluding youth","Youth parliaments, councils and consultation in policy-making","Age restrictions","Ignoring youth groups"],1,"Participation builds leadership and civic responsibility.");
  m(M,"Volunteering benefits young people by:",["Wasting time","Building skills, networks, civic values and employability","Reducing income permanently","Excluding them"],1,"It also benefits communities.");
  m(M,"Life skills education includes:",["Only mathematics","Decision-making, communication, problem-solving and coping with stress","Only sports","Only religion"],1,"Life skills help youth handle daily challenges.");
  m(M,"Prevention of cultism among youth in schools is best supported by:",["Ignoring it","Awareness, mentoring, positive clubs and activities, and cooperation with schools, parents and security agencies","Only arrests","Closing schools"],1,"Prevention addresses the reasons youth join.");
  x(M,"Match each youth programme to its main aim.",[["Entrepreneurship training","Business start-up and self-employment"],["Sports development","Health, teamwork and talent development"],["Leadership training","Building leadership and civic skills"],["Drug-abuse prevention","Reducing substance use"]],"Programmes address different youth needs.");
  o(M,"Arrange the stages of planning a youth programme.",["Needs assessment with young people","Set objectives","Design activities and select partners","Implement","Monitor and evaluate"],"Involving youth throughout improves relevance.");
  t(E,"Involving young people in designing programmes makes those programmes more relevant and effective.",true,"Youth voice is a key principle.");
  t(M,"Youth unemployment has no link to social problems such as crime.",false,"Unemployment can contribute to frustration and vulnerability to crime.");
  t(M,"Youth centres can provide safe spaces for recreation, learning and counselling.",true,"They are a common youth development facility.");
  s(E,"What does 'NYSC' stand for? (four words)",["national youth service corps"],"Established in 1973.");
  m(H,"A youth empowerment programme trains 500 youths, but follow-up shows few started businesses. The most likely gap is:",["Too much training","Lack of post-training support such as start-up capital, mentoring and market access","Too many participants","Training was too short only"],1,"Training alone rarely creates businesses without follow-up support.");
  m(M,"Monitoring a youth programme mainly involves:",["Only photographs","Regularly tracking activities, outputs and participation against the plan","Ending the programme","Recruiting staff only"],1,"Monitoring allows timely corrections.");

  for(var n in out)out[n].forEach(function(z){z.scope=n;});
  return out;
})();

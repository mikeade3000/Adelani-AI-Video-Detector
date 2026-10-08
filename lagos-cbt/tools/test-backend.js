#!/usr/bin/env node
/* Runs Code.gs + the shared files in Node with an in-memory store and stubbed
   Apps Script services, then exercises the request router.
   Run: node tools/test-backend.js */
"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const ROOT=path.join(__dirname,"..");
const ctx={
  console,
  Utilities:{
    DigestAlgorithm:{SHA_256:"sha256"},
    computeDigest:(alg,s)=>[...crypto.createHash(alg).update(String(s),"utf8").digest()],
    base64Encode:b=>Buffer.from(b.map(x=>x&255)).toString("base64"),
    getUuid:()=>crypto.randomUUID()
  }
};
vm.createContext(ctx);
for(const f of ["cbt-shared.js","cbt-bank-permsec.js","cbt-bank-law-enforcement.js","Code.gs"])
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),"utf8"),ctx,{filename:f});

function memStore(){
  const t={},cfg={};const tab=n=>(t[n]=t[n]||[]);
  const clone=o=>JSON.parse(JSON.stringify(o));
  return {
    readAll:n=>tab(n).map(clone),
    append:(n,r)=>{tab(n).push(clone(r));return r;},
    appendMany:(n,rs)=>rs.forEach(r=>tab(n).push(clone(r))),
    update:(n,id,p)=>{const r=tab(n).find(x=>x.id===id);if(r)Object.assign(r,clone(p));return r;},
    remove:(n,id)=>{const i=tab(n).findIndex(x=>x.id===id);if(i>=0)tab(n).splice(i,1);},
    replaceAll:(n,rs)=>{t[n]=rs.map(clone);},
    find:(n,id)=>{const r=tab(n).find(x=>x.id===id);return r?clone(r):null;},
    getConfig:()=>clone(cfg),
    setConfig:p=>{Object.assign(cfg,clone(p));return clone(cfg);},
    _t:t
  };
}

let pass=0,fail=0;
function check(cond,msg){if(cond){pass++;}else{fail++;console.error("FAIL:",msg);}}
const H=(store,body)=>ctx.handleRequest(store,body);

/* ---- fresh install ---- */
const s=memStore();
ctx.ensureSeed(s);
const qs=s.readAll("Questions");
check(qs.length===538,`fresh seed has 538 questions (got ${qs.length})`);
check(qs.filter(q=>q.scope==="Permanent Secretary Cadre").length>=200,"≥200 PS questions");
check(ctx.seedComplete_(s.getConfig()),"seed flags complete");
ctx.ensureSeed(s);check(s.readAll("Questions").length===538,"second seed is a no-op");

/* ---- forced password change ---- */
let r=H(s,{action:"login",username:"superadmin",password:"wrong"});
check(!r.ok,"wrong password rejected");
r=H(s,{action:"login",username:"superadmin",password:"changeme123"});
check(r.ok&&r.actor.mustChange===true,"default super must change password");
const sup=r.token;
check(H(s,{action:"createUser",token:sup,rec:{username:"x"},password:"12345678"}).error.includes("change your password"),"mustChange blocks other actions");
check(H(s,{action:"updateAccount",token:sup,id:"acc_super",patch:{mustChange:false}}).ok===false,"cannot clear own mustChange without a password");
check(H(s,{action:"updateAccount",token:sup,id:"acc_super",patch:{},password:"short"}).ok===false,"short password rejected");
check(H(s,{action:"updateAccount",token:sup,id:"acc_super",patch:{},password:"NewStrongPass1"}).ok,"super changes own password");
check(H(s,{action:"bootstrap",token:sup}).ok,"super can work after change");

/* ---- admin lifecycle ---- */
r=H(s,{action:"createAccount",token:sup,rec:{id:"acc_super",username:"admin1",name:"Admin One",role:"super"},password:"TempPass99"});
check(r.ok&&r.id!=="acc_super","createAccount ignores a colliding id / role");
const adminId=r.id;
check(s.find("Accounts",adminId).role==="admin"&&s.find("Accounts",adminId).mustChange===true,"new admin is role admin + mustChange");
check(H(s,{action:"deleteAccount",token:sup,id:"acc_super"}).ok===false,"super cannot delete self");
r=H(s,{action:"login",username:"admin1",password:"TempPass99"});const adm=r.token;
H(s,{action:"updateAccount",token:adm,id:adminId,patch:{},password:"AdminOwnPass1"});

/* ---- candidates ---- */
r=H(s,{action:"createUser",token:adm,rec:{username:"cand1",name:"Cand",cadre:"Not A Cadre",attemptsAllocated:2},password:"CandPass11"});
check(!r.ok,"unknown cadre rejected");
r=H(s,{action:"createUser",token:adm,rec:{username:"cand1",name:"Cand",attemptsAllocated:2,createdBy:"someone-else",passHash:"x"},password:"CandPass11"});
check(r.ok,"admin creates candidate");const candId=r.id;
check(s.find("Users",candId).createdBy===adminId,"createdBy forced to admin");
r=H(s,{action:"login",username:"cand1",password:"CandPass11"});const cand=r.token;
check(H(s,{action:"updateUser",token:cand,id:candId,patch:{cadre:"Fake",targetPost:"x",cadreLocked:true}}).ok===false,"candidate cannot pick a fake cadre");
check(H(s,{action:"updateUser",token:cand,id:candId,patch:{cadre:"Permanent Secretary Cadre",targetPost:"Permanent Secretary",cadreLocked:true}}).ok,"candidate locks PS cadre");
check(H(s,{action:"updateUser",token:cand,id:candId,patch:{cadre:"ICT Cadre"}}).ok&&s.find("Users",candId).cadre==="Permanent Secretary Cadre","locked cadre cannot be changed by candidate");

/* ---- candidate pool scoping ---- */
let b=H(s,{action:"bootstrap",token:cand});
check(b.questions.every(q=>q.scope==="COMMON"||q.scope==="Permanent Secretary Cadre"),"PS candidate sees COMMON + PS only");
check(b.questions.length===41+257,"PS pool size");

/* ---- server-side grading ---- */
const pick=b.questions.filter(q=>q.type==="mcq").slice(0,4);
const ict=qs.find(q=>q.scope.startsWith("Information"));
const per=[
  {qid:pick[0].id,given:pick[0].answer,correct:true},
  {qid:pick[1].id,given:(pick[1].answer+1)%pick[1].options.length,correct:true},   // wrong but claims correct
  {qid:pick[2].id,given:pick[2].answer,correct:false},
  {qid:pick[2].id,given:pick[2].answer,correct:true},                               // duplicate qid
  {qid:ict.id,given:ict.answer,correct:true}                                        // not in this cadre's pool
];
r=H(s,{action:"addAttempt",token:cand,rec:{id:"att_t1",userId:candId,score:99,total:5,per}});
check(r.ok&&r.score===2&&r.total===4,`server regrades (got ${r.score}/${r.total})`);
r=H(s,{action:"addAttempt",token:cand,rec:{userId:candId,per:[]}});
check(r.ok,"second attempt allowed");
r=H(s,{action:"addAttempt",token:cand,rec:{userId:candId,per:[]}});
check(!r.ok&&/No attempts/.test(r.error),"attempt cap enforced");

/* ---- law-enforcement group scope ---- */
r=H(s,{action:"createUser",token:adm,rec:{username:"lastma1",name:"T",cadre:"Traffic Management Officer Cadre (LASTMA)",targetPost:"Traffic Officer II",cadreLocked:true,attemptsAllocated:1},password:"TrafficPass1"});
check(r.ok,"traffic candidate created");
b=H(s,{action:"bootstrap",token:H(s,{action:"login",username:"lastma1",password:"TrafficPass1"}).token});
const scopes=new Set(b.questions.map(q=>q.scope));
check(scopes.has("GROUP: Law Enforcement (all enforcement cadres)")&&scopes.has("Traffic Management Officer Cadre (LASTMA)")&&!scopes.has("Vehicle Inspection Officer Cadre (VIS)"),"traffic officer sees COMMON + LE group + traffic, not VIS");

/* ---- question validation ---- */
r=H(s,{action:"addQuestions",token:adm,recs:[
  {id:pick[0].id,scope:"COMMON",category:"Logic",type:"mcq",stem:"New?",options:["a","b"],answer:1,explanation:"e"},
  {scope:"COMMON",category:"Logic",type:"mcq",stem:"Bad",options:["a","b"],answer:7},
  {scope:"COMMON",category:"Logic",type:"virus",stem:"x"}]});
check(r.ok&&r.count===1&&r.rejected===2&&r.ids[0]!==pick[0].id,"addQuestions validates and re-ids collisions");
check(H(s,{action:"addQuestions",token:cand,recs:[]}).ok===false,"candidate cannot add questions");

/* ---- config validation / key exposure ---- */
check(H(s,{action:"setConfig",token:adm,patch:{examLength:-4}}).ok===false,"bad examLength rejected");
check(H(s,{action:"setConfig",token:adm,patch:{examLength:"30",aiKey:"stolen"}}).config.examLength===30,"examLength coerced");
check(s.getConfig().aiKey!=="stolen","admin cannot set aiKey");
H(s,{action:"setConfig",token:sup,patch:{aiKey:"sk-secret"}});
check(!("aiKey" in H(s,{action:"bootstrap",token:adm}).config),"admin never receives aiKey");
check(!("aiKey" in H(s,{action:"bootstrap",token:cand}).config),"candidate never receives aiKey");

/* ---- logout invalidates the token ---- */
check(H(s,{action:"logout",token:cand}).ok,"logout ok");
check(H(s,{action:"bootstrap",token:cand}).error==="auth","token dead after logout");

/* ---- upgrade path: old database seeded before this release ---- */
const old=memStore();
old.setConfig({superSeeded:true,baseSeeded:true,seeded:true,ictSeeded:true});
old.appendMany("Questions",[
  {id:"q1",scope:"COMMON",category:"Lagos State Civil Service Rules",type:"ordering",difficulty:"hard",stem:"Arrange these disciplinary stages in their usual order of severity, from LEAST to MOST severe.",items:["Query","Warning","Suspension","Interdiction","Dismissal"],explanation:"old"},
  {id:"q2",scope:ctx.ICT_CADRE,category:"ICT",type:"mcq",difficulty:"medium",stem:"Which of the following is a valid IPv4 address?",options:["192.168.0.1","256.300.1.1","[www.gov.ng](https://www.gov.ng)","AB:CD:EF"],answer:0,explanation:"x"}]);
ctx.ensureSeed(old);
const oq=old.readAll("Questions");
check(oq.find(q=>q.id==="q1").items[2]==="Interdiction","patch fixes disciplinary ordering");
check(oq.find(q=>q.id==="q2").options[2]==="www.gov.ng","patch fixes IPv4 option");
check(oq.filter(q=>q.scope===ctx.ICT_CADRE).length===1,"ICT bank not re-seeded on upgrade");
check(oq.filter(q=>q.scope==="Permanent Secretary Cadre").length===257,"PS bank added on upgrade");
check(oq.some(q=>q.scope==="GROUP: Law Enforcement (all enforcement cadres)"),"LE group added on upgrade");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

#!/usr/bin/env node
/* Validates every seed question bank. Run: node tools/validate-banks.js
   Exits non-zero on any structural error. */
"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const ROOT=path.join(__dirname,"..");
const ctx={};vm.createContext(ctx);
for(const f of ["cbt-shared.js","cbt-bank-permsec.js","cbt-bank-law-enforcement.js"])
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),"utf8"),ctx,{filename:f});

/* keep in sync with CATEGORIES in index.html */
const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
const m=html.match(/const CATEGORIES=\[([\s\S]*?)\];/);
if(!m){console.error("CATEGORIES not found in index.html");process.exit(1);}
const CATEGORIES=JSON.parse("["+m[1]+"]");

const cadreNames=new Set(ctx.CADRES.map(c=>c.name));
const validScopes=new Set(["COMMON",...cadreNames,...ctx.SCOPE_GROUPS]);
const errors=[],warnings=[];
const all=[...ctx.SEED_QUESTIONS,...ctx.getSeedBanks().flatMap(b=>b.data)];
const sigs=new Map();
const answerPos={};

ctx.getSeedBanks().forEach(b=>{
  if(!validScopes.has(b.scope))errors.push(`bank ${b.key}: unknown scope ${b.scope}`);
  b.data.forEach((q,i)=>{if(q.scope!==b.scope)errors.push(`bank ${b.key}#${i}: scope "${q.scope}" ≠ bank scope`);});
});
Object.keys(ctx.CADRE_GROUPS).forEach(c=>{if(!cadreNames.has(c))errors.push(`CADRE_GROUPS key not a cadre: ${c}`);});

all.forEach((q,i)=>{
  const id=`[${q.scope.slice(0,24)}] ${String(q.stem).slice(0,60)}`;
  if(!validScopes.has(q.scope))errors.push(`${id}: unknown scope`);
  if(!CATEGORIES.includes(q.category))errors.push(`${id}: unknown category "${q.category}"`);
  if(!["easy","medium","hard"].includes(q.difficulty))errors.push(`${id}: bad difficulty`);
  if(!q.stem||!q.stem.trim())errors.push(`${id}: empty stem`);
  if(!q.explanation||q.explanation.length<10)errors.push(`${id}: missing explanation`);
  if(/\?\s*(Check|Recheck)/i.test(q.explanation))errors.push(`${id}: explanation contains working notes`);
  if(/\]\(https?:/.test(JSON.stringify(q)))errors.push(`${id}: markdown link corruption`);
  const sig=q.scope+"||"+q.category+"||"+q.type+"||"+q.stem;
  if(sigs.has(sig))errors.push(`${id}: duplicate stem`);sigs.set(sig,1);
  switch(q.type){
    case "mcq":
      if(!Array.isArray(q.options)||q.options.length<2)errors.push(`${id}: needs ≥2 options`);
      else{
        if(!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length)errors.push(`${id}: answer index out of range`);
        if(new Set(q.options.map(o=>o.trim().toLowerCase())).size!==q.options.length)errors.push(`${id}: duplicate options`);
        answerPos[q.answer]=(answerPos[q.answer]||0)+1;
      }
      break;
    case "truefalse":if(typeof q.answer!=="boolean")errors.push(`${id}: tf answer must be boolean`);break;
    case "shortanswer":
      if(!Array.isArray(q.accept)||!q.accept.length)errors.push(`${id}: needs accept[]`);
      else if(!q.accept.every(a=>ctx.cbtGrade(q,a)))errors.push(`${id}: an accepted answer does not grade as correct`);
      break;
    case "ordering":
      if(!Array.isArray(q.items)||q.items.length<2)errors.push(`${id}: needs ≥2 items`);
      else if(new Set(q.items).size!==q.items.length)errors.push(`${id}: duplicate items`);
      break;
    case "matching":
      if(!Array.isArray(q.pairs)||q.pairs.length<2)errors.push(`${id}: needs ≥2 pairs`);
      else{
        if(new Set(q.pairs.map(p=>p.l)).size!==q.pairs.length)errors.push(`${id}: duplicate left items`);
        if(new Set(q.pairs.map(p=>p.r)).size!==q.pairs.length)warnings.push(`${id}: duplicate right items`);
      }
      break;
    default:errors.push(`${id}: unknown type ${q.type}`);
  }
});

/* grading sanity */
const g=ctx.cbtGrade,t=(c,msg)=>{if(!c)errors.push("grading: "+msg);};
t(g({type:"shortanswer",accept:["1500000"]},"₦1,500,000"),"naira with commas");
t(g({type:"shortanswer",accept:["300.00"]},"300"),"300 = 300.00");
t(!g({type:"shortanswer",accept:["35"]},"3.5"),"3.5 must not equal 35");
t(g({type:"shortanswer",accept:["petition"]},"  Petition. "),"case/punctuation");
t(g({type:"shortanswer",accept:["="]},"="),"bare equals sign");
t(!g({type:"shortanswer",accept:["x"]},"  "),"blank answer");
t(g({type:"mcq",answer:2},2)&&!g({type:"mcq",answer:2},"2"),"mcq strict number");

/* report */
const byScope={},byCat={};
all.forEach(q=>{byScope[q.scope]=(byScope[q.scope]||0)+1;byCat[q.category]=(byCat[q.category]||0)+1;});
console.log("Questions per scope:");Object.entries(byScope).forEach(([k,v])=>console.log(`  ${String(v).padStart(4)}  ${k}`));
console.log("Questions per category:");Object.entries(byCat).forEach(([k,v])=>console.log(`  ${String(v).padStart(4)}  ${k}`));
console.log("MCQ answer positions:",JSON.stringify(answerPos));
console.log("TOTAL:",all.length);
warnings.forEach(w=>console.log("WARN",w));
if(errors.length){errors.forEach(e=>console.error("ERROR",e));console.error(errors.length+" error(s)");process.exit(1);}
console.log("OK — no errors");

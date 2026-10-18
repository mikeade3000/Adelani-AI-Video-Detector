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

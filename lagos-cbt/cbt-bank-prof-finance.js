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

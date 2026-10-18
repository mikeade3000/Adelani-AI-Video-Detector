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

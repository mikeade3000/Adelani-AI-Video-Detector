/*
 * Compact general-English word list used by the "best-of-two" OCR selector.
 * The selector prefers the OCR output whose tokens are most often found in
 * (rubric vocabulary ∪ this list). It is deliberately small: it only needs to
 * recognise ordinary words, not to be a full dictionary.
 */
(function (root) {
  'use strict';

  var COMMON =
    'a about above across act action active activity actually add added addition additional address adequate administration admit adopt advance advantage affect after again against age agency agent ago agree agreement ahead aid aim air all allow allowed almost alone along already also alter although always among amount an analyse analysis analyze and another answer any anyone anything appear application apply approach appropriate are area argue argument arise around arrange as ask aspect assess assessment assist associate assume at attack attempt attention authority available avoid away ' +
    'back bad balance base based basic basis be because become been before begin behaviour behavior behind being believe below benefit best better between beyond big bit body book both boundary break bring broad build business but by ' +
    'call called can capable capacity care carry case cases cause central certain chain chance change changes character check choice choose circumstance civil claim class clear clearly close code collect collection combine come common communicate communication community company compare complete complex component comprehensive concept concern conclude conclusion condition conduct confirm connect connection consequence consider considered consist constant contain content context continue contract control copy correct cost could country course cover create creates criminal critical current customer ' +
    'damage data date day deal decide decision define defined definition degree delete deliver demand demonstrate deny department depend describe description design destroy detail detect determine develop development device did difference different difficult direct directly discover discuss distinguish distribute do document does doing done down due during duty ' +
    'each early easily easy economic edit education effect effective efficient effort either electronic element else employ employee enable end enforce enough ensure enter entire entity environment equal equipment error especially essential establish estimate etc even event every everyone evidence exactly examine example examples except exchange exist existing expect experience explain explanation expose express extend external extra ' +
    'face fact factor fail failure fall false far fast feature few field figure file files final finally find first fix focus follow following for force form formal format found four free frequently from full function further future ' +
    'gain general generally get give given global go goal good govern government great group grow guarantee guide ' +
    'had half hand handle happen hard has have having he head help her here hidden high him his hold home how however human ' +
    'idea identify if image impact implement importance important improve in include included includes including incident increase indeed independent indicate individual industry information initial input inside install instance instead institution integrate intend intended interest internal into introduce investigate involve involves is issue issues it item items its itself ' +
    'job join just keep key kind know knowledge known ' +
    'lack large last later law laws lead learn least leave legal less level life like likely limit line link list little local location log long look loss low ' +
    'machine made main maintain major make makes making manage management manner many mark match material may mean means measure measures mechanism meet member memory method methods might mind minimum mobile model modify monitor more most move much must ' +
    'name nature necessary need needed needs network never new next no non normal not note nothing number object objective obtain occur of off offer office often old on once one only open operate operation operations or order organisation organization organise other others otherwise our out output over overall own owner ' +
    'part particular parties party pass pattern people per perform performance period permission person personal phase physical place plan point policy poor position possible potential power practice prepare present prevent previous primary principle principles private problem procedure procedures process processes produce product professional program programme proper property protect protected protection provide provided provides public purpose put ' +
    'quality question quick quickly quite ' +
    'range rather reach read real reason receive recent recognise recognize record records recover reduce refer regard regular related relevant rely remain remote remove repeat replace report represent request require required requirement requirements research resource resources respect respond response responsible rest result results return review right rights risk role rule rules run ' +
    'safe same save says scope second section secure see seek seen select send sense sensitive separate sequence serious serve service services set several shall share should show side sign significant similar simple since single site situation size skill small so social software solution some something sometimes source special specific stage standard standards start state statement step steps still stop store strong structure student study subject such suitable support sure system systems ' +
    'take taken target task team technical technique techniques technology term terms test than that the their them then theory there therefore these they thing things think third this those though threat threats three through thus time to together tool tools total towards track trust true try two type types ' +
    'under understand unit unless until up upon us use used useful user users uses using usually ' +
    'valid value variety various verify version very via view violate visible vulnerable ' +
    'want was way ways we weak well were what when where whether which while who whole whose why wide will with within without work world would write written wrong ' +
    'year yes yet you your ' +
    // Computing, security and forensic vocabulary common in theory papers.
    'access accountability accuracy admissible algorithm alteration antivirus app attacker attackers audit authentic authentication authorisation authorization authorized availability backup backups bandwidth biometric breach breaches browser brute bug certificate chain cipher ciphertext client cloud compromise computer computers confidentiality configuration cookie crime crimes cryptography custody cyber cybercrime cybersecurity database databases decrypt decryption denial digital disk domain download email encrypt encrypted encryption examiner exploit exploits firewall firewalls forensic forensics fraud hack hacker hackers hacking hardware hash hashing host identity imaging infrastructure integrity internet intrusion investigation investigator ip key keys laptop logging logs malicious malware network networks online packet password passwords patch payload penetration phishing port privacy privilege protocol ransomware recovery scan scanning server servers session social spam spoofing spyware storage trojan unauthorized unauthorised update upload virus viruses vulnerability vulnerabilities web website wireless worm';

  var set = Object.create(null);
  COMMON.split(/\s+/).forEach(function (w) { if (w) set[w] = true; });

  var api = { COMMON_WORDS: set };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GraderWords = api;
})(typeof self !== 'undefined' ? self : this);

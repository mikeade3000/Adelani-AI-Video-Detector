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

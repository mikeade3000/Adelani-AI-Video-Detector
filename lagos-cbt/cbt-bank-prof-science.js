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

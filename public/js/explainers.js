// WeatherNet "Learn" explainer library.
// Plain browser ES module, no imports. Content checked against the official NWS, SPC, NHC, WPC,
// NESDIS, NOAA and NSSL pages cited in each entry's `sources` (all verified HTTP 200 on 2026-10-09).

export const LEARN_GROUPS = [
  { id: "warnings", title: "Watches, warnings & tags" },
  { id: "outlooks", title: "Outlooks, discussions & reports" },
  { id: "storms", title: "Severe storms" },
  { id: "tropical", title: "Tropical cyclones" },
  { id: "winter-hazards", title: "Winter & other hazards" },
  { id: "satellite-radar", title: "Satellite & radar" },
];

export const EXPLAINERS = {
  // ───────────────────────── Watches, warnings & tags ─────────────────────────
  "tornado-watch": {
    title: "Tornado Watch",
    group: "warnings",
    icon: "🟨",
    summary: "SPC's signal that the environment can produce multiple tornadoes or a single intense one across a broad area over the next several hours.",
    body: [
      "A Tornado Watch is a forecast, not a detection. The Storm Prediction Center, which issues every tornado and severe thunderstorm watch in the Lower 48, chooses this type when ingredients favor multiple tornadoes or a single intense tornado; every Tornado Watch also covers large hail and damaging wind. Officially the watch is the list of counties SPC coordinates with local NWS offices; the parallelogram only approximates it. Typical watches span 20,000–40,000 square miles and run six to eight hours.",
      "Watches are not equal, and the products say so. The 'Primary threats include' bullets and the Watch Probability table rate each hazard for the whole watch area—the chance of two or more tornadoes, of one or more EF2+ tornadoes, of hail over 2 inches, of gusts over 65 knots—tagged Low (up to 20%), Moderate (30–60%) or High (70% and up). These are area probabilities, not the 25-mile point probabilities of the convective outlook, so the two can't be compared.",
      "Lead time is the point. SPC aims to issue a Tornado Watch about two hours before the first tornado, usually after a Mesoscale Discussion that states the odds of issuance. Only local offices can trim, extend or cancel counties, and hourly Watch Status Reports show where SPC sees the threat continuing.",
    ],
    lookFor: [
      "The watch type and number in the headline; 'THIS IS A PARTICULARLY DANGEROUS SITUATION' marks the rare high-end watch.",
      "The probability table: a 'High' rating for two or more tornadoes or for EF2+ tornadoes says more than the watch type alone.",
      "The aviation section's mean storm motion vector—'24045' means storms moving from 240° at 45 knots—and storm tops in hundreds of feet.",
      "A preceding SPC Mesoscale Discussion ('Tornado Watch likely'), then warnings blooming inside the watch on radar.",
    ],
    related: ["pds-watch", "tornado-warning", "mesoscale-discussion", "spc-outlook"],
    sources: [
      { label: "SPC: About SPC products — severe weather watches", url: "https://www.spc.noaa.gov/misc/about.html" },
      { label: "SPC: Frequently asked questions — watches", url: "https://www.spc.noaa.gov/faq/" },
      { label: "NWS: Tornado watch, warning and emergency", url: "https://www.weather.gov/safety/tornado-ww" },
    ],
  },

  "tornado-warning": {
    title: "Tornado Warning",
    group: "warnings",
    icon: "🌪️",
    summary: "A short-fused, polygon-based warning from the local NWS office: radar or reliable reports indicate a tornado, or one developing, right now.",
    body: [
      "Tornado Warnings come from the Weather Forecast Office that serves the area, not from SPC. The criterion is simple: radar indication and/or reliable reports of a tornado or a developing tornado. Each warning is a polygon drawn along the storm's projected track, typically valid 15 to 45 minutes, and updated through Severe Weather Statements as the storm evolves. Every Tornado Warning triggers Wireless Emergency Alerts.",
      "Read the tags at the bottom. 'TORNADO...RADAR INDICATED' means radar shows a tornado or developing tornado that is not confirmed; 'TORNADO...OBSERVED' means reliable reports or radar evidence such as a debris signature confirm one. Damage threat tags escalate further: CONSIDERABLE adds 'This is a PARTICULARLY DANGEROUS SITUATION,' and CATASTROPHIC turns the warning into a Tornado Emergency.",
      "Many warnings rest on radar alone—a tightening velocity couplet near the ground, a hook echo, a debris signature—because tornadoes are often rain-wrapped or nocturnal. The polygon, not the county, is the unit to watch: counties can be split, and the threat is the swath ahead of the circulation.",
    ],
    lookFor: [
      "The circulation near the upstream end of the polygon, with the box extending along the motion given in the TIME...MOT...LOC line.",
      "Storm-relative velocity: a tight, strengthening inbound/outbound couplet at the lowest tilts, ideally with vertical continuity.",
      "A debris signature (low correlation coefficient on the couplet)—the usual radar basis for switching the source tag to OBSERVED.",
      "Follow-up statements that change the source tag, add a damage threat tag, or update the towns in the path.",
    ],
    related: ["tornado-watch", "velocity-couplet", "debris-signature", "damage-threat-tags", "tornado-emergency"],
    sources: [
      { label: "NWS: Tornado watch, warning and emergency", url: "https://www.weather.gov/safety/tornado-ww" },
      { label: "NWS: Tornado impact-based warning tags (PDF)", url: "https://www.weather.gov/media/impacts/Tornado-IBW.pdf" },
      { label: "NWS Instruction 10-511: WFO severe weather products (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01005011curr.pdf" },
    ],
  },

  "pds-watch": {
    title: "PDS Watch (Particularly Dangerous Situation)",
    group: "warnings",
    icon: "⚠️",
    summary: "Rare SPC wording reserved for high-confidence forecasts of multiple intense tornadoes, or of an exceptional, fast-moving damaging-wind event.",
    body: [
      "'THIS IS A PARTICULARLY DANGEROUS SITUATION' is not a separate product; it is enhanced wording placed on a Tornado or Severe Thunderstorm Watch. For tornadoes, SPC uses it when it has a high-confidence forecast of multiple intense (EF2–EF5) tornadoes, typically long-lived ones. The decision is subjective—there are no hard thresholds—but the goal is explicit: three of every four PDS Tornado Watches should verify with multiple intense tornadoes.",
      "A PDS Severe Thunderstorm Watch follows different logic. SPC issues one when a large, well-defined bow echo is already producing widespread damaging winds, moving 55 mph or faster, with a downstream environment that will maintain or strengthen it—or when widespread significant severe weather (gusts over 75 mph, hail over 2 inches) is anticipated, usually from an exceptionally intense derecho.",
      "PDS watches are most often issued alongside a Day 1 High Risk, on days when SPC judges the atmosphere very volatile: rich moisture, strong instability and intense low-level shear overlapping where storms will form.",
    ],
    lookFor: [
      "The PDS line in the watch text, then the probability table: 'High' odds for multiple and for EF2+ tornadoes reinforce the call.",
      "A Day 1 High or Moderate Risk with CIG2–CIG3 tornado intensity on the SPC outlook.",
      "Discrete supercells forming in the warm sector rather than lines—watch velocity data for several couplets at once.",
      "For a PDS Severe Thunderstorm Watch: a mature bow echo with a rear-inflow notch and velocities above 70 mph near its apex.",
    ],
    related: ["tornado-watch", "spc-outlook", "supercell", "derecho"],
    sources: [
      { label: "SPC: About SPC products — PDS watches", url: "https://www.spc.noaa.gov/misc/about.html" },
      { label: "SPC: Frequently asked questions — PDS wording", url: "https://www.spc.noaa.gov/faq/" },
    ],
  },

  "tornado-emergency": {
    title: "Tornado Emergency",
    group: "warnings",
    icon: "🚨",
    summary: "The highest tornado alert: a Tornado Warning carrying the CATASTROPHIC damage threat tag, issued when a confirmed, violent tornado threatens a populated area.",
    body: [
      "A Tornado Emergency is not a separate product. It is a Tornado Warning in which the forecast office invokes the CATASTROPHIC damage threat, adding the headline '...TORNADO EMERGENCY FOR [location]...'. NWS directives require all three conditions: a severe threat to human life is imminent or ongoing, catastrophic damage is imminent or ongoing, and the tornado is confirmed visually by reliable sources or by radar evidence, such as a debris signature, that strongly suggests a damaging tornado.",
      "Because of its gravity, the call is never one forecaster's alone: it requires concurrence of the on-duty shift supervisor. The term was born on May 3, 1999, when NWS Norman forecasters, already warning on a tornado later rated F5 bearing down on Moore and south Oklahoma City, judged that a standard warning was not enough.",
      "The step below is the CONSIDERABLE tag—a 'Particularly Dangerous Situation' Tornado Warning—used when a strong tornado is confirmed but the breadth of damage ahead is less certain. Emergency language signals something different in kind: a violent tornado striking a populated area now.",
    ],
    lookFor: [
      "'TORNADO EMERGENCY' in the headline and third bullet, the CATASTROPHIC damage threat tag, and the source set to OBSERVED.",
      "A large, persistent debris signature extending up through several tilts, co-located with an intense velocity couplet.",
      "A reflectivity 'debris ball' at the hook tip, and at night power flashes on cameras along the path.",
      "LSRs of structural damage in or near the named locations.",
    ],
    related: ["tornado-warning", "damage-threat-tags", "debris-signature", "velocity-couplet", "ef-scale"],
    sources: [
      { label: "NWS: Understanding impact-based warning tags", url: "https://www.weather.gov/impacts/understanding" },
      { label: "NWS: Tornado impact-based warning tags (PDF)", url: "https://www.weather.gov/media/impacts/Tornado-IBW.pdf" },
      { label: "NWS Instruction 10-511: WFO severe weather products (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01005011curr.pdf" },
    ],
  },

  "severe-thunderstorm-warning": {
    title: "Severe Thunderstorm Warning",
    group: "warnings",
    icon: "⛈️",
    summary: "Local NWS warning for a storm producing, or about to produce, hail 1 inch or larger and/or wind gusts of 58 mph or more.",
    body: [
      "The NWS defines a severe thunderstorm as one producing hail at least 1 inch in diameter (quarter size), wind gusts of 58 mph (50 kt) or greater, or a tornado. A Severe Thunderstorm Warning is issued on radar or satellite indication or reliable reports of the hail or wind criteria, typically for 30 to 60 minutes. Lightning and flooding rain don't count toward 'severe'—flooding has its own warnings.",
      "Every warning carries machine-readable tags: MAX HAIL SIZE and MAX WIND GUST, each with a RADAR INDICATED or OBSERVED threat line, and sometimes 'TORNADO...POSSIBLE' when rotation is present but doesn't yet justify a Tornado Warning. A base warning shows 60 mph in the text even though the threshold is 58 mph. Damage threat tags then tier the threat: CONSIDERABLE at 70 mph or 1.75-inch hail, DESTRUCTIVE at 80 mph or 2.75-inch hail.",
      "Warning decisions lean on storm structure: a deep core of 60+ dBZ reflectivity extending well above the freezing level, a three-body scatter spike flagging large hail, or a bowing segment with a rear-inflow notch and strong velocities just above the ground. Only DESTRUCTIVE warnings trigger Wireless Emergency Alerts.",
    ],
    lookFor: [
      "The MAX HAIL SIZE and MAX WIND GUST values, whether each threat is RADAR INDICATED or OBSERVED, and any damage threat tag.",
      "Hail cores: 60+ dBZ aloft, a radial spike of weak echo behind the core, and inside it ZDR near zero with correlation coefficient falling to 0.70–0.95.",
      "Wind: bowing segments, rear-inflow notches and 50+ kt velocities in the lowest tilt—remembering the beam may be thousands of feet up.",
      "Measured gusts from ASOS and mesonets, and hail LSRs inside the polygon.",
    ],
    related: ["damage-threat-tags", "hail", "derecho", "radar-reflectivity", "tornado-warning"],
    sources: [
      { label: "NWS: Severe thunderstorm watch vs. warning", url: "https://www.weather.gov/safety/thunderstorm-ww" },
      { label: "NWS: Thunderstorm damage threat categories (PDF)", url: "https://www.weather.gov/media/lot/severe/New-NWS-Thunderstorm-Damage-Threat-Categories_2021.pdf" },
      { label: "SPC: Frequently asked questions — severe criteria", url: "https://www.spc.noaa.gov/faq/" },
    ],
  },

  "damage-threat-tags": {
    title: "Damage Threat Tags",
    group: "warnings",
    icon: "🏷️",
    summary: "Machine-readable tiers at the bottom of tornado, severe thunderstorm and flash flood warnings that grade expected severity and decide which warnings reach phones.",
    body: [
      "Impact-based warnings split each product into HAZARD, SOURCE and IMPACT lines and end with coded tags. The base level carries no damage tag: warning criteria are met. Above it, tags escalate. Tornado Warnings: CONSIDERABLE (a 'Particularly Dangerous Situation' for a strong, ongoing tornado) and CATASTROPHIC (a Tornado Emergency for a violent tornado with a severe threat to life). Every Tornado Warning, tagged or not, triggers Wireless Emergency Alerts.",
      "Severe Thunderstorm Warnings use hard numbers. Base: 58 mph gusts or 1-inch (quarter) hail. CONSIDERABLE: at least 70 mph or 1.75-inch (golf ball) hail. DESTRUCTIVE: at least 80 mph or 2.75-inch (baseball) hail. Whichever hazard reaches the higher tier sets the tag, and only DESTRUCTIVE triggers a phone alert; it also adds 'THIS IS A DESTRUCTIVE STORM FOR [locations]' to the text.",
      "Flash Flood Warnings: base for most flash floods; CONSIDERABLE for floods of unusual severity requiring urgent action; CATASTROPHIC—always paired with Flash Flood Emergency language—for exceedingly rare, violent flooding rising to levels rarely if ever seen. Only CONSIDERABLE and CATASTROPHIC flash flood warnings trigger Wireless Emergency Alerts.",
      "Source tags complete the picture: RADAR INDICATED means radar suggests the hazard but it isn't confirmed; OBSERVED means confirmation by radar or reliable reports. Snow Squall Warnings have their own tier, SIGNIFICANT; Extreme Wind Warnings carry no damage threat tags.",
    ],
    lookFor: [
      "The tag block at the end of the text: 'TORNADO DAMAGE THREAT...CONSIDERABLE', 'THUNDERSTORM DAMAGE THREAT...DESTRUCTIVE', 'FLASH FLOOD DAMAGE THREAT...CATASTROPHIC'.",
      "Upgrades in follow-up statements: a tag added mid-event usually follows a confirming report or a strengthening radar signature.",
      "Which warnings on the map reached phones: all Tornado Warnings, DESTRUCTIVE severe thunderstorm warnings, CONSIDERABLE or CATASTROPHIC flash flood warnings.",
    ],
    related: ["tornado-warning", "tornado-emergency", "severe-thunderstorm-warning", "flash-flood-warning", "flash-flood-emergency"],
    sources: [
      { label: "NWS: Understanding impact-based warning tags", url: "https://www.weather.gov/impacts/understanding" },
      { label: "NWS: Impact-based warnings factsheet (PDF)", url: "https://www.weather.gov/media/hazardsimplification/IBW-overview-4b.pdf" },
      { label: "NWS: Wireless Emergency Alerts", url: "https://www.weather.gov/wrn/wea" },
    ],
  },

  "flash-flood-warning": {
    title: "Flash Flood Warning",
    group: "warnings",
    icon: "🌧️",
    summary: "Issued when flash flooding is imminent or occurring: water rising rapidly, typically within six hours of intense rain, a dam failure or ice-jam release.",
    body: [
      "A flash flood is a rapid, extreme flow of water into a normally dry area, or a rapid rise of a stream above flood level, beginning within about six hours of its cause—intense rainfall, a dam or levee failure, an ice jam. Flash Flood Warnings are polygons drawn by the local office around the basins and streets at risk, valid until the dangerous flooding is expected to end, and can be extended through long-duration rain.",
      "The physics is a race between rain rate and the ground's capacity. River Forecast Centers compute flash flood guidance—the 1-, 3- and 6-hour rainfall that would bring streams to bankfull—and forecasters compare it with radar and gauge estimates. Saturated soils, burn scars, steep terrain and pavement shrink that margin; storms that train repeatedly over one basin overwhelm it.",
      "Tags at the bottom carry the detail: the source (RADAR INDICATED or OBSERVED), an optional expected rainfall rate, the causative event, and the damage threat. Base warnings no longer push phone alerts; only CONSIDERABLE and CATASTROPHIC flash flood warnings trigger Wireless Emergency Alerts.",
    ],
    lookFor: [
      "Training or back-building cells: echoes that redevelop at the upwind end and march over the same basin for an hour or more.",
      "MRMS rain rates and multi-hour totals versus flash flood guidance; tropical rain can be torrential at only 35–45 dBZ.",
      "Stream gauges spiking, WPC Mesoscale Precipitation Discussions, and LSRs of water rescues or flooded roads.",
      "The EXPECTED RAINFALL RATE tag and any burn-scar, debris-flow or dam-failure wording in the warning.",
    ],
    related: ["flash-flood-emergency", "excessive-rainfall-outlook", "mesoscale-discussion", "damage-threat-tags", "mcs"],
    sources: [
      { label: "NWS: Flood watch vs. warning", url: "https://www.weather.gov/safety/flood-watch-warning" },
      { label: "NWS: Impact-based Flash Flood Warnings factsheet (PDF)", url: "https://www.weather.gov/media/wrn/FFW-IBW-factsheet.pdf" },
      { label: "NWS Glossary: Flash flood", url: "https://forecast.weather.gov/glossary.php?word=flash%20flood" },
    ],
  },

  "flash-flood-emergency": {
    title: "Flash Flood Emergency",
    group: "warnings",
    icon: "🆘",
    summary: "Flash Flood Warning language reserved for exceedingly rare floods posing a severe threat to life and catastrophic damage, imminent or already underway.",
    body: [
      "Like its tornado counterpart, a Flash Flood Emergency is a Flash Flood Warning (or follow-up statement) with the CATASTROPHIC damage threat tag and the headline '...FLASH FLOOD EMERGENCY FOR [area]...'. It is used when a severe threat to human life and catastrophic damage from a flash flood is imminent or ongoing—water reaching people who are normally safe in floods.",
      "NWS guidance lists the situations that warrant it: emergency managers confirming that rapidly rising water is putting people in life-threatening danger; water rising several feet above floor level in homes that normally stay dry; multiple swift-water rescue teams deployed; gauges rising rapidly to at least major flood stage, or to levels rarely if ever seen; or total failure of a major high-hazard dam.",
      "The setups recur: stalled tropical cyclones, nocturnal storms training along a boundary, and intense rain over steep, urban or burn-scarred basins where runoff is fast. By design the language is exceedingly rare; when it appears, conditions are beyond anything a typical flash flood warning describes.",
    ],
    lookFor: [
      "'FLASH FLOOD EMERGENCY' in the headline and third bullet, with FLASH FLOOD DAMAGE THREAT...CATASTROPHIC.",
      "Gauges going nearly vertical—rises of many feet in an hour—and readings at or above major flood stage or record.",
      "LSRs of swift-water rescues and evacuations; MRMS hourly rates of 3+ inches persisting over the same basin.",
      "Dam- or levee-failure causative tags, which can produce an emergency with little rain falling locally.",
    ],
    related: ["flash-flood-warning", "damage-threat-tags", "excessive-rainfall-outlook", "atmospheric-river"],
    sources: [
      { label: "NWS Instruction 10-922: WFO water resources products (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01009022curr.pdf" },
      { label: "NWS: Understanding impact-based warning tags", url: "https://www.weather.gov/impacts/understanding" },
      { label: "NWS: Flood watch vs. warning", url: "https://www.weather.gov/safety/flood-watch-warning" },
    ],
  },

  "extreme-wind-warning": {
    title: "Extreme Wind Warning",
    group: "warnings",
    icon: "💨",
    summary: "A short-fused warning for the onset of a major hurricane's extreme sustained winds—115 mph (100 kt) or more, usually the eyewall—within the hour.",
    body: [
      "Local NWS offices issue an Extreme Wind Warning when two conditions are met: the tropical cyclone is Category 3 or stronger on the Saffir-Simpson scale, and sustained surface winds of 100 knots (115 mph, 185 km/h) or greater are occurring or expected on land in the office's area within one hour. It is the tornado-warning analog for a hurricane's core.",
      "The warning outlines the forecaster-drawn area of greatest impact, is valid for up to three hours, and is followed by Severe Weather Statements with observed winds and damage. Its call to action mirrors a tornado warning's: take shelter immediately in an interior portion of a well-built structure. It requests EAS activation and triggers Wireless Emergency Alerts.",
      "Why a separate warning? Hurricane wind is not uniform. The strongest winds are generally found at the inner edge of the eyewall, and small eyewall mesovortices and convective downbursts can add narrow swaths of stronger gusts. A Hurricane Warning goes up about 36 hours ahead of tropical-storm-force winds; an Extreme Wind Warning targets the next hour.",
    ],
    lookFor: [
      "The eyewall on radar: the ring of highest reflectivity and strongest Doppler velocities approaching land (velocities near the core often need dealiasing; offices may run VCP 112).",
      "Reconnaissance flight-level and SFMR surface winds, and NHC intermediate advisories confirming Category 3 or stronger.",
      "Rapid pressure falls and extreme gusts on ASOS, buoys and mesonet stations as the eyewall arrives—many fail before peak.",
      "Small rotating mesovortices along the inner edge of the eyewall in velocity and reflectivity loops.",
    ],
    related: ["saffir-simpson", "tropical-watches-warnings", "rapid-intensification", "radar-reflectivity"],
    sources: [
      { label: "NWS: Hurricane and tropical storm watches and warnings", url: "https://www.weather.gov/safety/hurricane-ww" },
      { label: "NWS Instruction 10-601: WFO tropical cyclone products (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01006001curr.pdf" },
      { label: "NWS: Wireless Emergency Alerts", url: "https://www.weather.gov/wrn/wea" },
    ],
  },

  "red-flag-warning": {
    title: "Red Flag Warning",
    group: "warnings",
    icon: "🚩",
    summary: "Fire-weather warning issued when locally agreed fuel-dryness and weather criteria—wind, very low humidity, dry lightning—are occurring or expected within 48 hours.",
    body: [
      "A Red Flag Warning tells land managers and the public that critical fire weather is occurring or imminent: conditions that support extreme fire behavior and rapid spread of new or existing fires. There is no national threshold. Each NWS office sets Red Flag criteria with land-management agencies in an interagency Annual Operating Plan, combining fuel dryness from fire-danger indices with weather—strong winds, very low relative humidity, dry frontal passages, lightning or dry thunderstorms.",
      "Why those ingredients: low humidity drives down dead-fuel moisture, so fine fuels such as grass ignite easily and burn fast; wind supplies oxygen and pushes flames and embers ahead of the fire front; dry lightning supplies ignitions with little rain to douse them. Downslope windstorms—Santa Ana, Diablo, chinook—stack the deck: compressional warming and very dry air arrive with strong, gusty winds.",
      "A Fire Weather Watch often precedes it, 18 to 96 hours ahead. When criteria are greatly exceeded or near records, offices may flag the exceptional hazard in the headline. Nationally, SPC's fire weather outlooks—Elevated, Critical, Extremely Critical, and isolated or scattered dry thunderstorm areas—give the broader context.",
    ],
    lookFor: [
      "Afternoon humidity in the single digits to teens with sustained winds of 20+ mph on ASOS and RAWS, and poor overnight humidity recovery on ridges.",
      "GOES shortwave infrared (3.9 µm) and Fire Temperature RGB hot spots that appear and grow; smoke plumes lengthening downwind in visible loops.",
      "Dry lightning: GLM flashes over areas with little radar-indicated rain, inside SPC dry thunderstorm areas.",
      "Pyrocumulus or pyrocumulonimbus towers over large fires; radar shows smoke and ash plumes as low-correlation-coefficient echoes.",
    ],
    related: ["satellite-bands", "goes", "geocolor", "heat-risk"],
    sources: [
      { label: "NWS: Wildfire watches, warnings and behavior", url: "https://www.weather.gov/safety/wildfire-ww" },
      { label: "NWS Instruction 10-401: Fire weather products (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01004001curr.pdf" },
      { label: "SPC: About SPC products — fire weather outlooks", url: "https://www.spc.noaa.gov/misc/about.html" },
    ],
  },

  // ─────────────────────── Outlooks, discussions & reports ───────────────────────
  "spc-outlook": {
    title: "SPC Convective Outlook",
    group: "outlooks",
    icon: "🗺️",
    summary: "SPC's Day 1–3 severe-weather forecast: probabilities of tornadoes, wind and hail within 25 miles, combined with expected intensity into a 1–5 risk category.",
    body: [
      "The categories—1 Marginal, 2 Slight, 3 Enhanced, 4 Moderate, 5 High—are derived, not drawn freehand. On Days 1 and 2, forecasters draw separate probability contours for tornadoes, severe wind and severe hail, each the chance of at least one event within 25 miles of a point; Day 3 uses a single combined severe probability. A light-green general thunderstorm line marks a 10% or greater chance of thunderstorms.",
      "Since March 3, 2026, each hazard also carries a Conditional Intensity Group—how strong events should be if they occur—replacing the old hatched 'significant severe' areas. Below CIG1, tornadoes are mostly EF0–EF1, gusts mostly under 74 mph, hail mostly under 2 inches. CIG1 means a reasonable maximum of EF2, gusts of 74+ mph or hail over 2 inches; CIG2, EF3, a possible bow echo or derecho, or hail over 3.5 inches; CIG3 (tornado and wind only), EF4+ or a high-end derecho.",
      "Coverage and intensity combine through fixed tables. A 10% tornado area with no intensity group is only Slight; the same 10% with CIG1 becomes Enhanced. High Risk needs both: tornado probabilities of 30% or more with CIG2+ (or 60% with CIG1), or wind of 45% with CIG3 or 60% with CIG2+. Hail alone tops out at Moderate. Moderate-or-higher days average about 14 a year; High Risk days, two or three.",
      "Day 1 updates at 06, 13, 1630, 20 and 01 UTC. Days 4–8 show only 15% and 30% total-severe areas, equivalent to Slight and Enhanced. Read the probabilities, not just the color: violent tornadoes have occurred in Slight, Enhanced and Moderate risks.",
    ],
    lookFor: [
      "The separate tornado, wind and hail panels and their CIG shading—the category alone hides which hazard drives it.",
      "Changes between issuances (13Z, 1630Z, 20Z) as morning soundings, mesoanalysis and early storms resolve uncertainty.",
      "The plain-language summary at the top of the text, stating expected hazards, timing and storm mode.",
      "A Public Severe Weather Outlook, issued on Moderate and High Risk days.",
    ],
    related: ["mesoscale-discussion", "tornado-watch", "ingredients", "pds-watch", "excessive-rainfall-outlook"],
    sources: [
      { label: "SPC: About SPC convective outlooks (coverage, intensity, conversion tables)", url: "https://www.spc.noaa.gov/about/outlooks/" },
      { label: "SPC: Conditional Intensity reference (PDF)", url: "https://www.spc.noaa.gov/about/outlooks/SPC_Conditional_Intensity_Reference.pdf" },
      { label: "SPC: About SPC products", url: "https://www.spc.noaa.gov/misc/about.html" },
    ],
  },

  "mesoscale-discussion": {
    title: "Mesoscale Discussion",
    group: "outlooks",
    icon: "🔎",
    summary: "SPC's short-fuse technical note on an evolving threat—often the first word that a severe weather watch is coming, with stated odds.",
    body: [
      "A Mesoscale Discussion (MD) explains what SPC forecasters see developing over the next few hours and why. Severe-potential MDs carry a 'concerning' line that references an existing watch or gives the probability of one: WATCH UNLIKELY (5 or 20%), WATCH POSSIBLE (40 or 60%), WATCH LIKELY or TORNADO WATCH LIKELY (80 or 95%). SPC aims to issue them one to two hours before a watch.",
      "The first paragraph is a plain-language summary of timing, coverage, intensity and storm mode; the second is the meteorology—boundaries, instability and shear trends, capping, satellite and radar evolution. That second paragraph is where you learn what the forecaster is uncertain about, and what would change the call.",
      "MDs also cover winter hazards: snowfall rates over 1 inch per hour (2 inches in lake-effect bands or at 4,000–8,000 feet), freezing rain over 0.05 inch in three hours, and blizzard conditions lasting more than three hours. For flash flooding, WPC issues the parallel product—Mesoscale Precipitation Discussions headlined FLASH FLOODING LIKELY, POSSIBLE or UNLIKELY, ideally one to six hours ahead.",
    ],
    lookFor: [
      "The MD graphic's outlined area and its 'Probability of Watch Issuance' percentage.",
      "Wording that shifts from 'trends will be monitored' to watch issuance expected soon, and the valid time.",
      "The satellite clues MDs cite: agitated cumulus along a boundary, towers breaking the cap, first overshooting tops.",
      "Whether a watch follows, and how its type and probabilities compare with the MD's expectation.",
    ],
    related: ["spc-outlook", "tornado-watch", "excessive-rainfall-outlook", "flash-flood-warning"],
    sources: [
      { label: "SPC: About SPC products — mesoscale discussions", url: "https://www.spc.noaa.gov/misc/about.html" },
      { label: "WPC: Mesoscale Precipitation Discussions", url: "https://www.wpc.ncep.noaa.gov/metwatch/metwatch_mpd.php" },
    ],
  },

  "excessive-rainfall-outlook": {
    title: "Excessive Rainfall Outlook",
    group: "outlooks",
    icon: "☔",
    summary: "WPC's Day 1–5 forecast of the probability that rainfall exceeds flash flood guidance within 25 miles of a point, in four risk categories.",
    body: [
      "The ERO forecasts one thing: the chance that rain will exceed flash flood guidance within 25 miles (40 km) of a point. Flash flood guidance, from the River Forecast Centers, is the 1-, 3- or 6-hour rainfall estimated to bring streams to bankfull. The categories: Marginal (at least 5%), Slight (at least 15%), Moderate (at least 40%) and High (at least 70%).",
      "The scale is not linear in impact. High Risk days—typically slow-moving tropical systems, atmospheric rivers or strong mid-latitude storms—account for about two of every five U.S. flood fatalities and a large majority of flood-related property losses, per WPC. Any risk area means forecasters expect at least some flash flooding; higher categories signal organized heavy rain affecting numerous locations.",
      "As with SPC's outlooks, low-looking numbers are high relative to climatology: flash floods are rare at any one spot. Day 1 is issued at 01, 09 and 15 UTC; Days 2–3 twice daily; experimental Days 4–5 show only Slight and Moderate. Because flash flood guidance drops as soils saturate, a second round of rain needs less to flood than the first.",
    ],
    lookFor: [
      "The risk contours and WPC's discussion of the rain mechanism—training convection, tropical moisture, orographic lift.",
      "Precipitable water well above normal in soundings and satellite moisture products, with slow storm motion parallel to a boundary.",
      "WPC Mesoscale Precipitation Discussions appearing inside the risk area as the event unfolds.",
      "Upgrades to Moderate or High on later issuances as confidence grows.",
    ],
    related: ["flash-flood-warning", "flash-flood-emergency", "mesoscale-discussion", "atmospheric-river", "spc-outlook"],
    sources: [
      { label: "WPC: Excessive Rainfall Outlook", url: "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php" },
      { label: "WPC: Product descriptions — EROs", url: "https://www.wpc.ncep.noaa.gov/html/fam2.shtml" },
      { label: "WPC: ERO High Risk climatology and impacts", url: "https://www.wpc.ncep.noaa.gov/qpf/eroclimo/" },
    ],
  },

  "local-storm-reports": {
    title: "Local Storm Reports",
    group: "outlooks",
    icon: "📍",
    summary: "Preliminary NWS reports of what actually happened—tornadoes, hail, wind gusts, damage, flooding, snow—with time, place, magnitude and source.",
    body: [
      "Local Storm Reports (LSRs) are the NWS's real-time log of observed hazardous weather. Offices issue them for tornadoes, waterspouts, large hail, thunderstorm and marine wind gusts, and flash floods, plus snow, ice, dense fog and other events. Hail reports start at 0.75 inch, below the 1-inch severe threshold. Each report lists event type, time, location, magnitude, source and remarks.",
      "Read the magnitude's prefix and the source. 'M' means measured and 'E' estimated: 'M76 MPH' from an ASOS is a hard number, while 'E70 MPH' is a judgment, often inferred from damage. Sources range from trained spotters, emergency managers and law enforcement to broadcast media, the public, social media, and automated stations such as ASOS and mesonets.",
      "LSRs are preliminary by design. SPC compiles them into daily storm-report maps (12 UTC to 12 UTC); duplicates are common, and a 'tornado' can become thunderstorm wind after a damage survey. The quality-controlled record is Storm Data and NCEI's Storm Events Database, compiled months later; reports arriving more than seven days late go straight there.",
    ],
    lookFor: [
      "Clusters of wind-damage LSRs along a bow echo's path, or a line of tornado reports tracing a single supercell.",
      "Measured (M) gusts from ASOS, AWOS and mesonets versus estimated (E) values; hail sizes compared with radar MESH.",
      "The remarks: 'trees and power lines down', 'roof removed', 'water rescue'—the impact behind the magnitude.",
      "Timing: reports can arrive minutes to hours after the event, and the listed times can be approximate.",
    ],
    related: ["ef-scale", "severe-thunderstorm-warning", "tornado-warning", "hail", "record-event-report"],
    sources: [
      { label: "SPC: Today's storm reports", url: "https://www.spc.noaa.gov/climo/reports/today.html" },
      { label: "NWS Instruction 10-517: Multi-purpose products, incl. LSRs (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01005017curr.pdf" },
      { label: "SPC: About SPC products — storm report statistics", url: "https://www.spc.noaa.gov/misc/about.html" },
    ],
  },

  "record-event-report": {
    title: "Record Event Report",
    group: "outlooks",
    icon: "📈",
    summary: "An NWS climate product issued when an official station ties or breaks a record—daily, monthly, seasonal or all-time—for temperature, precipitation or snow.",
    body: [
      "The RER is event-driven: it goes out whenever an existing record value is met or exceeded at a climate station, and the AWIPS climate software flags many daily records automatically. Record types include highest and lowest temperatures, the highest minimum and lowest maximum, the most precipitation and snowfall in a calendar day, and greatest snow depth, with monthly, seasonal and all-time versions.",
      "Context matters. Many city records come from threaded station histories: NCEI, working with the NWS and a regional climate center, combined records from successive sites in a city—downtown, then the airport—into longer periods of record under a project called ThreadEx. A record at a site with a short period of record means less, and offices may append a note saying so.",
      "All of it is preliminary until NCEI quality control. Statewide records go further: a potential new state extreme triggers a site visit and equipment check, review by a State Climate Extremes Committee, and a final ruling by NCEI. Meanwhile the office's RER states that the record is under review.",
    ],
    lookFor: [
      "'RECORD EVENT REPORT' headers with phrasing like '...breaks the old record of [value] set in [year]' or '...ties the record'.",
      "Record warm lows during heat waves—often more telling for heat stress than record highs.",
      "The station's period of record, and whether it is a threaded city record.",
      "Clusters of RERs across a region on the same day, which map an anomaly's footprint better than any single station.",
    ],
    related: ["local-storm-reports", "heat-risk", "atmospheric-river", "lake-effect-snow"],
    sources: [
      { label: "NWS Instruction 10-1004: Climate records (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01010004curr.pdf" },
      { label: "NCEI: State Climate Extremes Committee", url: "https://www.ncei.noaa.gov/access/monitoring/scec/" },
    ],
  },

  // ─────────────────────────────── Severe storms ───────────────────────────────
  supercell: {
    title: "Supercell",
    group: "storms",
    icon: "🔄",
    summary: "A thunderstorm with a deep, persistent rotating updraft—the mesocyclone—responsible for most violent tornadoes and the largest hail.",
    body: [
      "A supercell is a long-lived, highly organized storm built around a single tilted, rotating updraft. The rotation starts in the environment: vertical wind shear creates horizontal vorticity, and an updraft tilts it into the vertical. When low-level winds also turn with height—strong storm-relative helicity—the updraft ingests that spin efficiently, and rotation becomes the storm's organizing engine, with low pressure aloft that helps sustain the updraft.",
      "Supercells usually need deep-layer shear of roughly 35–40 knots or more through the lowest 6 km, plus enough instability for a strong updraft. Most move to the right of the mean wind, favored by hodographs that turn clockwise with height. A mesocyclone is typically 2–6 miles across and can exist 20–60 minutes before a tornado forms, if one forms at all.",
      "Most supercells never produce a tornado. Odds rise when low-level shear is strong (0–1 km storm-relative helicity above about 100 m²/s²), cloud bases are low (LCL under roughly 1,000 m), and the downdraft air wrapping around the mesocyclone is not too cold—though tornadogenesis is still not fully understood. Classic, low-precipitation and high-precipitation supercells differ mainly in how much rain wraps the mesocyclone, which controls how visible a tornado is.",
    ],
    lookFor: [
      "Reflectivity: a hook echo on the right-rear flank, an inflow notch, and a bounded weak echo region aloft marking the updraft.",
      "Velocity: a persistent mesocyclone couplet a few miles across that tightens and strengthens toward the lowest tilt.",
      "Satellite: a long-lived overshooting top, a sharp-edged anvil and often an above-anvil cirrus plume.",
      "Storm motion deviating to the right of neighboring cells, and discrete cells rather than lines.",
    ],
    related: ["ingredients", "velocity-couplet", "hail", "tornado-warning", "overshooting-tops"],
    sources: [
      { label: "NSSL: Severe Weather 101 — thunderstorm types", url: "https://www.nssl.noaa.gov/education/svrwx101/thunderstorms/types/" },
      { label: "NWS Glossary: Supercell", url: "https://forecast.weather.gov/glossary.php?word=supercell" },
      { label: "SPC: Mesoanalysis parameter help", url: "https://www.spc.noaa.gov/exper/mesoanalysis/help/begin.html" },
    ],
  },

  qlcs: {
    title: "QLCS (Squall Lines & Bow Echoes)",
    group: "storms",
    icon: "〰️",
    summary: "Quasi-linear convective systems—squall lines and bow echoes—whose embedded mesovortices produce damaging winds and brief, rain-wrapped tornadoes, often at night.",
    body: [
      "A QLCS is a line or arc of thunderstorms organized by its own cold pool. Rain-cooled outflow spreads ahead as a gust front, lifting warm, moist inflow into new updrafts along the leading edge. As the cold pool strengthens, a rear-inflow jet descends from the back of the system; where it reaches the ground, the line bows outward and damaging straight-line winds result.",
      "Nearly 20% of U.S. tornadoes come from QLCSs. They form from mesovortices along the leading edge and tend to be weaker and shorter-lived than supercell tornadoes, but they spin up fast, are wrapped in rain, and often arrive overnight. NWS warning guidance uses a 'three ingredients' check: cold pool and low-level shear roughly balanced, 0–3 km line-normal shear of 30 knots or more, and a surge or bow driven by a rear-inflow jet.",
      "Because a QLCS tornado can develop within minutes of mesovortex genesis, forecasters often warn on the precursors—a bulging surge, a rear-inflow notch, a mesovortex with rotational velocity of 25 knots or more—rather than waiting for a debris signature. Large bows can last for hours and, when they persist long enough, become derechos.",
    ],
    lookFor: [
      "Reflectivity: bowing segments, rear-inflow notches cutting into the back of the line, line breaks, and 'bookend' vortices at the ends.",
      "Velocity: strong inbound/outbound pairs along the leading edge, especially at the north end of a surge or bow.",
      "Mid-altitude radial convergence (MARC) at roughly 8,000–16,000 feet—a precursor to damaging surges.",
      "Overnight damage reports along the leading edge; QLCS debris signatures are often small and brief.",
    ],
    related: ["derecho", "mcs", "velocity-couplet", "tornado-warning", "severe-thunderstorm-warning"],
    sources: [
      { label: "NSSL: Severe Weather 101 — tornado types", url: "https://www.nssl.noaa.gov/education/svrwx101/tornadoes/types/" },
      { label: "NWS: QLCS mesovortex warning reference sheets (PDF)", url: "https://www.weather.gov/media/lsx/QLCS_Warnings.pdf" },
      { label: "NOAA JetStream: Bow echoes", url: "https://www.noaa.gov/jetstream/derechos/bow-echoes" },
    ],
  },

  derecho: {
    title: "Derecho",
    group: "storms",
    icon: "🌬️",
    summary: "A widespread, long-lived windstorm from a fast-moving, cold-pool-driven convective system, with damage swaths of 250+ miles and several 75+ mph gusts.",
    body: [
      "SPC's current definition, revised in 2016 and again in 2025: a swath of wind damage at least 250 miles (about 400 km) long, continuous or intermittent; gusts of at least 58 mph along most of its length; several well-separated gusts of 75 mph (121 km/h) or more; and a parent MCS at least 60 miles wide that moves faster than the mean wind, meaning its cold pool drives it. Radar should show bow echoes and rear-inflow jets.",
      "Older definitions required only a roughly 240-mile swath of 58 mph gusts; the stricter criteria filter out shorter-lived, less organized wind events. A derecho is a family of downbursts, microbursts and downburst clusters sustained by a cycle: the cold pool lifts air at the gust front, new storms form downwind, and their rain-cooled air reinforces the cold pool—forward propagation that can outrun the mean flow.",
      "Derechos are most common in the warm season. Peak gusts can exceed 100 mph—128 mph was measured in eastern Wisconsin on May 31, 1998—and the Aug. 10, 2020 derecho produced widespread 80–100 mph winds across eastern Iowa. Prolonged power outages across huge areas are the signature impact.",
    ],
    lookFor: [
      "A bow echo or series of bows moving 50 mph or faster, with a rear-inflow notch and a sharp leading gust front.",
      "Doppler velocities of 70–100 mph in the lowest tilts behind the leading edge, and bookend vortices at the bow's ends.",
      "A shelf cloud on cameras; in IR satellite, a long arc of outflow ahead of an expanding cold cloud shield.",
      "Measured 75+ mph gusts on ASOS and mesonets, a lengthening string of wind-damage LSRs, and PDS Severe Thunderstorm Watches downstream.",
    ],
    related: ["qlcs", "mcs", "pds-watch", "severe-thunderstorm-warning", "local-storm-reports"],
    sources: [
      { label: "SPC: About derechos — facts and current definition", url: "https://www.spc.noaa.gov/misc/AbtDerechos/derechofacts.htm" },
      { label: "SPC: Derecho FAQ", url: "https://www.spc.noaa.gov/misc/AbtDerechos/derechofaq.htm" },
      { label: "NOAA JetStream: Bow echoes", url: "https://www.noaa.gov/jetstream/derechos/bow-echoes" },
    ],
  },

  mcs: {
    title: "Mesoscale Convective System",
    group: "storms",
    icon: "🌩️",
    summary: "A thunderstorm complex organized on a larger scale than individual cells and lasting hours—a major source of warm-season heavy rain, flash floods and damaging wind.",
    body: [
      "An MCS is any thunderstorm complex that organizes on a scale larger than its individual storms and persists for several hours or more—squall lines, bow echoes, clusters, even tropical cyclones. The best-known subtype, the mesoscale convective complex (MCC), is defined from infrared satellite: a cloud shield of −32°C or colder covering at least 100,000 km², with a −52°C core of at least 50,000 km², lasting six hours and nearly circular.",
      "Many MCSs peak at night. Afternoon storms on the High Plains merge into a cold pool after sunset, and the nocturnal low-level jet keeps feeding warm, moist air into the system overnight. Behind them they can leave a mesoscale convective vortex (MCV), a mid-level circulation 30–60 miles wide that can persist up to 12 hours and seed the next day's storms.",
      "Propagation decides the hazard. When new cells form on the downwind side of the cold pool, the system races forward and produces wind—sometimes a derecho. When new cells keep forming on the upwind flank, that part of the gust front stalls and storms train over the same ground, a classic flash-flood setup.",
    ],
    lookFor: [
      "IR satellite: an expanding, cold, circular-to-oval cloud shield at night, with GLM lightning concentrated where new cells are building.",
      "Radar: the leading convective line and trailing stratiform rain; watch which flank keeps generating new cells.",
      "Morning visible imagery: an MCV's cloud swirl, or an outflow boundary arc that becomes the next day's focus.",
      "Training echoes over the same counties and climbing MRMS multi-hour totals, often followed by WPC Mesoscale Precipitation Discussions.",
    ],
    related: ["derecho", "qlcs", "flash-flood-warning", "excessive-rainfall-outlook", "satellite-bands"],
    sources: [
      { label: "NSSL: Severe Weather 101 — thunderstorm types", url: "https://www.nssl.noaa.gov/education/svrwx101/thunderstorms/types/" },
      { label: "NWS Glossary: Mesoscale convective complex", url: "https://forecast.weather.gov/glossary.php?word=mesoscale%20convective%20complex" },
      { label: "SPC: About derechos — propagation of convective systems", url: "https://www.spc.noaa.gov/misc/AbtDerechos/derechofacts.htm" },
    ],
  },

  hail: {
    title: "Hail",
    group: "storms",
    icon: "⚾",
    summary: "Ice grown in thunderstorm updrafts; 1-inch stones are severe, 2-inch significant, and baseball-size (2.75-inch) hail triggers a DESTRUCTIVE warning tag.",
    body: [
      "Hailstones start as frozen drops or graupel carried into the supercooled part of an updraft, then grow as supercooled droplets freeze onto them. Fast freezing traps air and makes cloudy ice; slow freezing makes clear ice. The layers record changing temperature and liquid-water conditions as the stone drifts across and around the updraft—not simple up-and-down cycling. A stone falls when the updraft can no longer support it.",
      "Size depends on updraft strength and on how long a stone stays where liquid water is still available—between the freezing level and about −40°F (−40°C). Broad, rotating supercell updrafts produce the giants. Reference sizes: quarter 1 inch, golf ball 1.75, tennis ball 2.5, baseball 2.75, softball 4. The U.S. record, from Vivian, South Dakota, in 2010, measured 8 inches across and weighed 1 lb 15 oz.",
      "Fall speeds are slower than once assumed—wind-tunnel tests with casts of real stones suggest 9–25 mph for stones under an inch and 25–40 mph for 1–1.75-inch hail—but wind-driven hail shreds siding and windows. Swaths can reach 10 miles wide and 100 miles long; 'hail alley,' where Colorado, Nebraska and Wyoming meet, averages seven to nine hail days a year.",
    ],
    lookFor: [
      "Reflectivity above about 55–60 dBZ extending well above the freezing level, and a three-body scatter spike—a radial flare of weak echo behind the core.",
      "Dual-pol inside the core: ZDR near zero (tumbling stones look round to the radar) and correlation coefficient dropping to roughly 0.70–0.95.",
      "MRMS Maximum Estimated Size of Hail (MESH) swaths, checked against hail LSRs and mPING reports.",
      "Satellite: persistent overshooting tops and above-anvil cirrus plumes, both tied to the strong updrafts that grow large hail.",
    ],
    related: ["supercell", "severe-thunderstorm-warning", "damage-threat-tags", "radar-reflectivity", "overshooting-tops"],
    sources: [
      { label: "NSSL: Severe Weather 101 — hail basics", url: "https://www.nssl.noaa.gov/education/svrwx101/hail/" },
      { label: "NSSL: Severe Weather 101 — hail detection", url: "https://www.nssl.noaa.gov/education/svrwx101/hail/detection/" },
      { label: "NWS Boston: Using dual-pol radar (PDF)", url: "https://www.weather.gov/media/box/science/Using_Dual_Pol_Radar.pdf" },
    ],
  },

  "ef-scale": {
    title: "Enhanced Fujita Scale",
    group: "storms",
    icon: "🏚️",
    summary: "The U.S. tornado rating system since 2007: wind speeds estimated from surveyed damage to 28 indicators, from EF0 (65–85 mph) to EF5 (over 200 mph).",
    body: [
      "The EF scale replaced the original Fujita scale on February 1, 2007. It is a damage scale: surveyors match what they find to one of 28 damage indicators—from one- and two-family homes to schools, towers and hardwood trees—and assign a degree of damage, each tied to an expected range of 3-second gusts. EF0 is 65–85 mph, EF1 86–110, EF2 111–135, EF3 136–165, EF4 166–200, EF5 over 200.",
      "The wind numbers are estimates, not measurements. They describe a 3-second gust at the point of damage, which is not the same as a standard surface observation, and they depend on construction quality: a poorly anchored house fails at far lower wind than an engineered building. A tornado is rated by the most intense damage found along its path, so an EF4 may be EF4 for only a short stretch.",
      "Ratings come from NWS damage surveys, published in Public Information Statements and the Damage Assessment Toolkit, usually within days. Because the scale rates damage, a tornado crossing open country can be underrated simply because it hit nothing that could reveal its strength, and radar-measured winds don't by themselves set the rating.",
    ],
    lookFor: [
      "NWS Public Information Statements on damage surveys: EF rating, estimated peak wind, path length and width, start and end times.",
      "The Damage Assessment Toolkit viewer: survey points color-coded by EF rating, each tied to a damage indicator and degree of damage.",
      "Debarked trees and well-built homes swept from their foundations—among the highest degrees of damage, if construction quality supports it.",
      "Preliminary ratings in LSRs that change once the survey is complete.",
    ],
    related: ["local-storm-reports", "tornado-emergency", "debris-signature", "supercell"],
    sources: [
      { label: "SPC: Enhanced F Scale for tornado damage", url: "https://www.spc.noaa.gov/faq/tornado/ef-scale.html" },
      { label: "SPC: The Enhanced Fujita Scale", url: "https://www.spc.noaa.gov/efscale/" },
    ],
  },

  ingredients: {
    title: "Severe Storm Ingredients",
    group: "storms",
    icon: "🧪",
    summary: "Moisture, instability and lift make thunderstorms; vertical wind shear organizes them into supercells, lines and long-lived severe systems.",
    body: [
      "Thunderstorms need three things. Moisture, usually measured by dewpoint or precipitable water, supplies latent heat. Instability—warm, moist air beneath air that cools rapidly with height—lets a lifted parcel stay warmer than its surroundings; CAPE (J/kg) integrates that buoyancy, while CIN measures the cap that must be overcome. Lift—fronts, drylines, outflow boundaries, terrain, sea breezes—brings parcels to their level of free convection.",
      "The fourth ingredient, vertical wind shear, decides what kind of storm forms. Weak shear yields pulse storms that rain into their own updrafts and collapse. Deep-layer shear of roughly 35–40 knots or more over the lowest 6 km (or effective bulk shear rising through 25–40 knots) separates updraft from downdraft and favors supercells. Strong low-level shear—0–1 km storm-relative helicity above about 100 m²/s²—plus cloud bases below roughly 1,000 m raises tornado potential.",
      "Composite indices bundle these: the Significant Tornado Parameter multiplies normalized CAPE, LCL height, helicity, shear and CIN, and most significant (EF2+) tornadoes have occurred with values above 1. But indices describe environments, not storms—if nothing initiates, or the cap holds, a high-STP day can stay quiet. Cool-season Southeast events often pair modest CAPE with extreme shear.",
    ],
    lookFor: [
      "SPC mesoanalysis: CAPE and CIN, effective bulk shear, 0–1 km helicity, LCL height and STP overlapping in the same place.",
      "Soundings, including special midday launches, for the cap, lapse rates and hodograph shape—a long, curved hodograph means strong, turning shear.",
      "Visible satellite: agitated cumulus along boundaries, cloud streets in the warm sector, and the first towers breaking the cap.",
      "Surface obs: dewpoints in the 60s–70s °F surging north, pressure falls, and backed winds near warm fronts and drylines.",
    ],
    related: ["supercell", "spc-outlook", "mesoscale-discussion", "qlcs", "hail"],
    sources: [
      { label: "NSSL: Severe Weather 101 — thunderstorm basics", url: "https://www.nssl.noaa.gov/education/svrwx101/thunderstorms/" },
      { label: "SPC: Mesoanalysis parameter help", url: "https://www.spc.noaa.gov/exper/mesoanalysis/help/begin.html" },
      { label: "SPC: Frequently asked questions — weather questions", url: "https://www.spc.noaa.gov/faq/" },
    ],
  },

  // ────────────────────────────── Tropical cyclones ──────────────────────────────
  "saffir-simpson": {
    title: "Saffir-Simpson Hurricane Wind Scale",
    group: "tropical",
    icon: "🌀",
    summary: "NHC's 1–5 hurricane rating based solely on maximum 1-minute sustained wind; Category 3 (111+ mph) and stronger are major hurricanes.",
    body: [
      "The scale rates a hurricane only by its maximum sustained surface wind—the highest 1-minute average at 10 meters (33 feet) in open exposure. Category 1: 74–95 mph (64–82 kt). Category 2: 96–110 mph (83–95 kt). Category 3: 111–129 mph (96–112 kt). Category 4: 130–156 mph (113–136 kt). Category 5: 157 mph (137 kt) or higher. Categories 3–5 are major hurricanes.",
      "What it leaves out matters as much. The category says nothing about storm surge, rainfall flooding or tornadoes, nor about size. NHC removed the old surge and pressure ranges to reduce confusion: Hurricane Ike (2008), a huge Category 2, pushed a surge of about 20 feet into Texas, while tiny Category 4 Charley (2004) produced about 7 feet in Florida.",
      "The category is a snapshot of peak wind somewhere in the storm, typically a small area near the eyewall; most of a hurricane's footprint experiences far less. Damage rises steeply with speed—wind pressure scales roughly with the square of wind speed—so each step up the scale brings disproportionately more destruction. In the western Pacific, 'super typhoon' denotes sustained winds above 150 mph.",
    ],
    lookFor: [
      "The advisory intensity and its basis: reconnaissance flight-level and SFMR winds, dropsondes, or satellite (Dvorak) estimates.",
      "A clear, warm eye ringed by very cold cloud tops in IR—the look of an intense hurricane.",
      "Wind radii (34, 50 and 64 kt) in the advisory: size often matters more than category for surge and the wind footprint.",
      "Intensity jumps between advisories: a rise of 30 knots or more within 24 hours meets NHC's rapid-intensification definition.",
    ],
    related: ["rapid-intensification", "storm-surge", "extreme-wind-warning", "tropical-watches-warnings", "nhc-cone"],
    sources: [
      { label: "NHC: Saffir-Simpson Hurricane Wind Scale", url: "https://www.nhc.noaa.gov/aboutsshws.php" },
      { label: "NHC: About the Saffir-Simpson Hurricane Wind Scale (PDF)", url: "https://www.nhc.noaa.gov/pdf/sshws.pdf" },
      { label: "NHC: Glossary", url: "https://www.nhc.noaa.gov/aboutgloss.shtml" },
    ],
  },

  "storm-surge": {
    title: "Storm Surge",
    group: "tropical",
    icon: "🌊",
    summary: "The abnormal rise of seawater pushed ashore by a storm's winds, over and above the astronomical tide—the leading cause of hurricane fatalities.",
    body: [
      "Storm surge is the rise in water level generated by a storm, over and above the predicted astronomical tide; storm tide is the two combined, and inundation is the depth of water above normally dry ground. Onshore winds pile water against the coast, and as the storm reaches shallow water the ocean bottom blocks the return circulation, forcing water upward and inland. Low pressure adds a smaller contribution.",
      "Peak surge depends on intensity, size, forward speed, angle of approach and the shape of the continental shelf. Larger storms push on more water for longer; faster storms raise higher surge at the coast while slower ones drive it farther inland; a wide, gently sloping shelf amplifies it. Surge can travel up rivers and canals well inland, and waves ride on top of it.",
      "NHC and local offices issue Storm Surge Watches (life-threatening inundation possible, generally within 48 hours) and Warnings (danger of life-threatening inundation, generally within 36 hours) along the U.S. Gulf and East coasts, Puerto Rico and the Virgin Islands—and, new in 2026, Hawaii. The Potential Storm Surge Flooding Map shows inundation with a 10% chance of being exceeded: a reasonable worst case for each location.",
    ],
    lookFor: [
      "NHC's Peak Storm Surge graphic (feet above ground) and the Potential Storm Surge Flooding Map for specific neighborhoods.",
      "NOAA tide gauges running feet above the predicted tide—the difference is the surge.",
      "Onshore flow on the right side of the track at landfall (Northern Hemisphere), especially into bays and estuaries.",
      "Water rising hours before the center arrives, and offshore winds draining bays on the other side of the storm (negative surge).",
    ],
    related: ["tropical-watches-warnings", "saffir-simpson", "nhc-cone", "extreme-wind-warning"],
    sources: [
      { label: "NHC: Storm surge overview", url: "https://www.nhc.noaa.gov/surge/" },
      { label: "NHC: Storm surge products", url: "https://www.nhc.noaa.gov/surge/products.php" },
      { label: "NHC: Products and services update for 2026 (PDF)", url: "https://www.nhc.noaa.gov/pdf/2026NHCNewProductsAndServices.pdf" },
    ],
  },

  "nhc-cone": {
    title: "NHC Forecast Cone",
    group: "tropical",
    icon: "📐",
    summary: "The area that should contain the storm's center about two-thirds of the time—not the size of the storm, and not where impacts stop.",
    body: [
      "The cone is built by sweeping circles along NHC's forecast track at 12, 24, 36, 48, 60, 72, 96 and 120 hours. Each circle's radius is set so that two-thirds of NHC's official track errors over the previous five years fell within it. For 2026, Atlantic radii run from 25 nautical miles at 12 hours to 95 at 72 hours and 200 at 120 hours, about 4–8% smaller than in 2025.",
      "Read it correctly. Historically the center stays inside the cone only about 60–70% of the time, so roughly a third of the time it strays outside. The cone also says nothing about storm size or impacts: hurricane-force winds, surge, tornadoes and flooding rain routinely reach far beyond its edges, and areas well outside it often see tornadoes and inland flooding.",
      "New for 2026, the operational cone graphic shows all U.S. coastal and inland tropical storm and hurricane watches and warnings, with a single shading for the full five days. NHC is also testing an experimental cone built from ellipses that capture 90% of along- and cross-track errors, rather than circles at two-thirds.",
    ],
    lookFor: [
      "Watches and warnings drawn on land, now including inland counties—those, not the cone, mark where NHC expects wind impacts.",
      "Wind speed probability and arrival-of-tropical-storm-force-winds graphics for specific locations.",
      "Track shifts between advisories: movement within the cone is normal forecast error, not a failed forecast.",
      "The storm's actual size in the advisory's wind radii, which can far exceed the cone's half-width early in the forecast.",
    ],
    related: ["tropical-watches-warnings", "storm-surge", "saffir-simpson", "rapid-intensification"],
    sources: [
      { label: "NHC: Definition of the track forecast cone", url: "https://www.nhc.noaa.gov/aboutcone.shtml" },
      { label: "NHC: Products and services update for 2026 (PDF)", url: "https://www.nhc.noaa.gov/pdf/2026NHCNewProductsAndServices.pdf" },
      { label: "NWS: Hurricane and tropical storm watches and warnings", url: "https://www.weather.gov/safety/hurricane-ww" },
    ],
  },

  "rapid-intensification": {
    title: "Rapid Intensification",
    group: "tropical",
    icon: "⏫",
    summary: "An increase in a tropical cyclone's maximum sustained winds of at least 30 knots (35 mph) in 24 hours—among the hardest changes to forecast.",
    body: [
      "NHC defines rapid intensification (RI) as a 30-knot or greater rise in maximum sustained wind within 24 hours. It needs a favorable environment—warm water with deep ocean heat content, low vertical wind shear, a moist mid-troposphere—and a storm structured to use it: once a compact, symmetric inner core and closed eyewall form, heat released by eyewall convection concentrates near the center and the vortex spins up efficiently.",
      "RI is dangerous because it can turn a modest storm into a major hurricane within a day or two of landfall, shortening preparation time. Guidance has improved—statistical tools such as the SHIPS Rapid Intensification Index estimate RI probabilities every six hours, and NOAA's high-resolution HAFS model has run operationally since 2023—but predicting exactly when RI starts and stops remains difficult.",
      "Watch the inner core. Eyewall replacement cycles—a new outer eyewall forming and choking off the inner one—can pause or reverse intensification and broaden the wind field, then allow re-intensification. Dry air or a burst of shear can end it abruptly.",
    ],
    lookFor: [
      "IR: a central dense overcast that grows colder and more symmetric, then an eye that clears and warms; repeated inner-core convective bursts with GLM lightning.",
      "Passive-microwave imagery showing a closed ring of deep convection around the center.",
      "Reconnaissance fixes with steadily falling central pressure and rising flight-level and SFMR winds.",
      "NHC discussions citing high RI-index probabilities or explicitly forecasting rapid intensification.",
    ],
    related: ["saffir-simpson", "extreme-wind-warning", "nhc-cone", "satellite-bands", "overshooting-tops"],
    sources: [
      { label: "NHC: Glossary — rapid intensification", url: "https://www.nhc.noaa.gov/aboutgloss.shtml" },
      { label: "NOAA AOML Hurricane Research Division: Hurricane FAQ", url: "https://www.aoml.noaa.gov/hrd-faq/" },
    ],
  },

  "tropical-watches-warnings": {
    title: "Tropical Watches & Warnings",
    group: "tropical",
    icon: "📢",
    summary: "Coastal and inland alerts timed to the arrival of tropical-storm-force winds: watches about 48 hours ahead, warnings about 36 hours ahead.",
    body: [
      "A Hurricane Warning means sustained winds of 74 mph (64 kt) or more are expected somewhere in the area; a Hurricane Watch means they are possible. Tropical Storm Warnings and Watches do the same for sustained winds of 39–73 mph (34–63 kt). Timing is keyed to tropical-storm-force winds, not hurricane winds, because preparations become difficult once 39 mph winds arrive: warnings go out 36 hours ahead, watches 48.",
      "Wind and water are warned separately. Storm Surge Watches and Warnings cover life-threatening inundation, and a location can be under a surge warning without a hurricane warning, or vice versa. A Hurricane Warning can stay up after winds drop below hurricane force while dangerous water persists. Inland, local offices carry the same watches and warnings into counties far from the coast.",
      "Watches and warnings can go up before a storm even forms. NHC issues 'Potential Tropical Cyclone' advisories for disturbances threatening land with tropical-storm or hurricane conditions—since 2025, up to 72 hours before surge or tropical-storm-force winds reach land—and continues them for post-tropical cyclones still producing dangerous conditions.",
    ],
    lookFor: [
      "The advisory's watch and warning list with breakpoints, and the 2026 cone graphic's inland shading.",
      "The arrival-of-tropical-storm-force-winds graphic: treat the 'earliest reasonable' arrival time as the deadline for finishing preparations.",
      "Local Hurricane Statements and the local office's wind, surge, flood and tornado threat graphics.",
      "Advisory cadence: with coastal watches or warnings in effect, NHC issues public advisories every three hours.",
    ],
    related: ["nhc-cone", "storm-surge", "extreme-wind-warning", "saffir-simpson"],
    sources: [
      { label: "NWS: Hurricane and tropical storm watches and warnings", url: "https://www.weather.gov/safety/hurricane-ww" },
      { label: "NHC: Glossary", url: "https://www.nhc.noaa.gov/aboutgloss.shtml" },
      { label: "NHC: Products and services update for 2026 (PDF)", url: "https://www.nhc.noaa.gov/pdf/2026NHCNewProductsAndServices.pdf" },
    ],
  },

  // ─────────────────────────── Winter & other hazards ───────────────────────────
  "atmospheric-river": {
    title: "Atmospheric River",
    group: "winter-hazards",
    icon: "💧",
    summary: "A long, narrow corridor of concentrated water-vapor transport; landfalling ARs bring much of the West Coast's precipitation and many of its floods.",
    body: [
      "Atmospheric rivers are relatively long, narrow regions that carry most of the water vapor transported outside the tropics. An average AR moves roughly the Mississippi River's mean discharge in vapor form; the strongest carry up to about 15 times that. Forecasters measure them by integrated water vapor transport (IVT), and AR conditions begin at 250 kg per meter per second.",
      "Rain comes when that moisture is forced upward. Orographic lift—an AR striking the Coast Ranges, Sierra Nevada or Cascades head-on—can wring out extreme totals, while warm ARs raise snow levels and can drive rain-on-snow flooding. Duration matters as much as intensity: the AR Scale ranks events 1 to 5 by peak IVT (250, 500, 750, 1,000, 1,250+), up one category if AR conditions last over 48 hours, down one if under 24.",
      "Not all ARs cause damage. Most are weak and beneficial, and a few AR events supply 30–50% of annual precipitation in the West Coast states. Strong ones that stall over vulnerable watersheds—burn scars, saturated soils—produce the floods, mudslides and debris flows. The 'Pineapple Express,' tapping moisture near Hawaii, is the best-known strong type.",
    ],
    lookFor: [
      "IVT and integrated water vapor plots showing a narrow plume reaching from the subtropics to the coast.",
      "GOES water vapor and blended total precipitable water imagery: a continuous moisture band ahead of a cold front.",
      "Radar bright band and rising snow levels; persistent heavy rain on windward slopes with rain shadows downwind.",
      "WPC Excessive Rainfall Outlooks, flood watches, and burn-scar flash flood warnings along the coast and mountains.",
    ],
    related: ["excessive-rainfall-outlook", "flash-flood-warning", "flash-flood-emergency", "satellite-bands"],
    sources: [
      { label: "NOAA: What are atmospheric rivers?", url: "https://www.noaa.gov/stories/what-are-atmospheric-rivers" },
      { label: "NOAA Physical Sciences Laboratory: Atmospheric river portal", url: "https://psl.noaa.gov/arportal/" },
    ],
  },

  "lake-effect-snow": {
    title: "Lake-Effect Snow",
    group: "winter-hazards",
    icon: "🌨️",
    summary: "Narrow bands of intense snow that form when cold air crosses relatively warm, unfrozen lakes, delivering 2–3 inches per hour or more.",
    body: [
      "When cold air flows over open Great Lakes water, heat and moisture from the lake destabilize the lowest layer of the atmosphere. The working rule: a lake-surface-to-850-mb temperature difference of at least 13°C (23°F)—roughly a dry-adiabatic lapse rate—supports pure lake-effect convection. Air rises, condenses and organizes into bands that can produce 2–3 inches of snow per hour while a mile or two away the sun shines.",
      "Band type follows the wind. Flow along a lake's long axis gives the longest fetch and a single intense band—the type that buries Buffalo or the Tug Hill. Flow across the short axis produces multiple, weaker wind-parallel bands. Directional shear of more than about 30° through the boundary layer disrupts bands, a low capping inversion limits their depth, and ice cover shuts the process down.",
      "Totals can be extreme over tiny areas—several feet in a day or two beneath a stalled band, with near-zero visibility and little snow just miles away. Terrain such as the Tug Hill Plateau adds orographic lift. NWS offices may issue Lake Effect Snow Warnings and Advisories, or winter storm products where regions prefer.",
    ],
    lookFor: [
      "Radar: a narrow, persistent band streaming off the lake; bands are shallow, so distant radars overshoot them.",
      "Visible satellite: cloud streets and bands blooming from the upwind shore and streaming downwind.",
      "850-mb temperatures versus lake-surface temperature (a 13°C+ difference), and wind direction relative to the lake's long axis.",
      "Webcams and ASOS: visibility collapsing as a band arrives, then clearing as it shifts.",
    ],
    related: ["blizzard", "satellite-bands", "radar-reflectivity", "mesoscale-discussion"],
    sources: [
      { label: "NWS: Lake effect snow", url: "https://www.weather.gov/safety/winter-lake-effect-snow" },
      { label: "NWS Eastern Region Technical Attachment 2000-05: lake-effect snow (PDF)", url: "https://www.weather.gov/media/erh/ta/ta2000-05.pdf" },
      { label: "NWS: Winter weather warnings, watches and advisories", url: "https://www.weather.gov/safety/winter-ww" },
    ],
  },

  blizzard: {
    title: "Blizzard",
    group: "winter-hazards",
    icon: "❄️",
    summary: "Defined by wind and visibility, not snowfall: 35+ mph sustained winds or frequent gusts with snow cutting visibility below 1/4 mile for 3+ hours.",
    body: [
      "A blizzard requires sustained winds or frequent gusts of 35 mph or more, plus falling and/or blowing snow that frequently reduces visibility to less than 1/4 mile, for at least three consecutive hours. Temperature and snowfall amount are not part of the definition: a ground blizzard can occur under clear skies when strong winds loft snow already on the ground.",
      "The physics is a pressure gradient meeting loose snow. Deep cyclones and strong arctic highs drive sustained winds; fresh, dry, cold snow has little cohesion and lofts easily, while wet or crusted snow resists. On the open Plains and prairies nothing interrupts the fetch, so blowing and drifting continue long after flakes stop falling.",
      "Local offices issue Blizzard Warnings on those criteria; short, intense bursts of whiteout that don't last three hours are handled with Snow Squall Warnings or other winter products. SPC issues winter Mesoscale Discussions when blizzard conditions are expected to last more than three hours.",
    ],
    lookFor: [
      "ASOS visibility of 1/4 mile or less with heavy or blowing snow and gusts of 35+ mph in three consecutive hourly observations.",
      "Tight pressure gradients behind a deepening low, with strong winds through the cold sector.",
      "Road cameras and closures; satellite can look deceptively clear during a ground blizzard.",
      "WPC's Winter Storm Severity Index blowing-snow component.",
    ],
    related: ["lake-effect-snow", "ice-storm", "mesoscale-discussion", "goes"],
    sources: [
      { label: "NWS: Winter weather warnings, watches and advisories", url: "https://www.weather.gov/safety/winter-ww" },
      { label: "NWS Glossary: Blizzard", url: "https://forecast.weather.gov/glossary.php?word=blizzard" },
      { label: "NWS Instruction 10-513: WFO winter weather products (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01005013curr.pdf" },
    ],
  },

  "ice-storm": {
    title: "Ice Storm",
    group: "winter-hazards",
    icon: "🧊",
    summary: "Freezing rain that glazes trees, wires and roads; Ice Storm Warnings typically begin around 1/4 inch of accumulation on elevated flat surfaces.",
    body: [
      "Freezing rain needs an inverted temperature profile. Snow falls into a warm layer aloft (above 0°C) deep enough to melt it completely, then drops through a shallow subfreezing layer near the ground—too thin to refreeze the drops. They arrive supercooled and freeze on contact with anything at or below freezing. If the cold layer is deeper, the drops refreeze into sleet instead.",
      "Accretion limits itself in subtle ways. Freezing releases latent heat, so heavy rates and temperatures near 32°F favor runoff rather than sticking; steadier rain into colder surface air accretes more efficiently. Ice loading builds fast: by around 1/4 inch, snapped power lines and falling branches become likely, and wind on iced lines and limbs multiplies the damage.",
      "NWS Ice Storm Warning criteria are set locally and measured as flat ice on an elevated horizontal surface—typically around 1/4 inch or more. Because the warm nose can be only a degree or two above freezing, small errors in the temperature profile decide whether a city gets rain, sleet, freezing rain or snow.",
    ],
    lookFor: [
      "Soundings and model profiles with a warm nose above 0°C over a shallow surface layer at or below freezing.",
      "Dual-pol radar: the melting-layer bright band—high reflectivity and ZDR, lowered correlation coefficient—and where it sits relative to the surface freezing line.",
      "Surface obs reporting freezing rain (FZRA), ASOS ice-accretion remarks (I1/I3/I6 groups, in hundredths of an inch), and mPING reports.",
      "WPC probabilities of freezing rain of 0.25 inch or more, and the WSSI ice-accumulation component.",
    ],
    related: ["blizzard", "radar-reflectivity", "atmospheric-river", "mesoscale-discussion"],
    sources: [
      { label: "NWS: Winter weather warnings, watches and advisories", url: "https://www.weather.gov/safety/winter-ww" },
      { label: "NSSL: Severe Weather 101 — winter weather types", url: "https://www.nssl.noaa.gov/education/svrwx101/winter/types/" },
      { label: "WPC: Winter weather forecasts — freezing rain probabilities", url: "https://www.wpc.ncep.noaa.gov/wwd/winter_wx.shtml" },
    ],
  },

  "heat-risk": {
    title: "Heat Index, WBGT & HeatRisk",
    group: "winter-hazards",
    icon: "🌡️",
    summary: "Three NWS heat tools, three questions: how hot it feels in shade, stress in sun and exertion, and health risk for this place and date.",
    body: [
      "The heat index combines air temperature and relative humidity into an apparent temperature for a person in the shade with a light wind; 96°F at 65% humidity yields 121°F. Full sun can add up to 15°F, and strong winds in very hot, dry air are hazardous in their own right. It is the classic basis for Heat Advisories, typically around a 100–105°F maximum heat index depending on region.",
      "Wet Bulb Globe Temperature (WBGT) adds what the heat index ignores: direct sunlight and wind, alongside temperature and humidity. It is the preferred measure for athletes and outdoor workers, because a sunny, breezy 90°F afternoon and a cloudy, still one stress an exercising body very differently. NWS publishes WBGT forecasts.",
      "HeatRisk, still labeled experimental, asks a health question. It compares forecast highs and lows over a 24-hour period with location- and date-specific thresholds—the warmest 5% of local temperatures, informed by CDC heat-health data—so early-season heat and warm nights rank higher. Levels run from 0 (green, little or no risk) to 4 (magenta, extreme, with no overnight relief); it expanded across the Lower 48 in 2024.",
      "Official alerts remain separate: Heat Advisory, Extreme Heat Watch and Extreme Heat Warning, which replaced the 'Excessive Heat' names in 2025. Criteria are local; a common Extreme Heat Warning benchmark is a 105–110°F heat index with lows of 75°F or higher for two days.",
    ],
    lookFor: [
      "HeatRisk maps: orange (2) and red (3) spreading over cities with warm overnight lows; magenta (4) for prolonged, extreme heat.",
      "Dewpoints in the 70s °F and overnight lows that barely fall—record warm lows often matter more than record highs.",
      "WBGT forecasts for sun-exposed afternoons versus the heat index for shaded conditions.",
      "Extreme Heat Warnings, and Record Event Reports for highest minimum temperatures.",
    ],
    related: ["record-event-report", "red-flag-warning", "haboob"],
    sources: [
      { label: "NWS: Heat index, WBGT and HeatRisk", url: "https://www.weather.gov/safety/heat-index" },
      { label: "WPC/NWS: HeatRisk", url: "https://www.wpc.ncep.noaa.gov/heatrisk/" },
      { label: "NWS: Heat watches, warnings and advisories", url: "https://www.weather.gov/safety/heat-ww" },
    ],
  },

  haboob: {
    title: "Haboob",
    group: "winter-hazards",
    icon: "🏜️",
    summary: "A wall of dust driven ahead of a thunderstorm's outflow, dropping visibility to near zero within moments on desert highways.",
    body: [
      "A haboob is a wall of dust pushed along the ground by a thunderstorm downdraft. Rain-cooled air spreads out as a density current and races outward along the gust front, lifting loose soil from dry desert floors and fields. The dust wall can tower thousands of feet high and stretch for miles along an arc-shaped front, often well ahead of the storm that produced it.",
      "Haboobs are a signature of the summer monsoon in Arizona's low deserts around Phoenix, where storms over higher terrain collapse in the evening and send outflow across the valleys; West Texas, New Mexico and the Plains get them too. Evaporation of rain falling through the deep, dry desert boundary layer chills the air and strengthens the downdrafts that drive them.",
      "NWS offices issue short-fused, polygon-based Dust Storm Warnings when blowing dust cuts visibility to 1/4 mile or less, usually with winds of 25 mph or more, and Dust Advisories for visibility from 1/4 to 1 mile. Warnings run 20 minutes to two hours and trigger Wireless Emergency Alerts. Widespread, gradient-driven dust gets zone-based Blowing Dust products instead.",
    ],
    lookFor: [
      "Radar: a fine line or arc of weak echo racing ahead of collapsing storms; dust shows low correlation coefficient.",
      "Visible satellite and GeoColor: a tan arc of dust spreading from storm complexes in the late afternoon or evening.",
      "ASOS visibility collapsing to 1/4 mile or less with a sharp wind shift, strong gusts, falling temperature and rising dewpoint.",
      "Highway cameras along Interstates 10 and 8 in Arizona as the dust wall approaches.",
    ],
    related: ["severe-thunderstorm-warning", "geocolor", "radar-reflectivity", "red-flag-warning"],
    sources: [
      { label: "NSSL: Severe Weather 101 — damaging wind types", url: "https://www.nssl.noaa.gov/education/svrwx101/wind/types/" },
      { label: "NWS Instruction 10-515: non-precipitation products, incl. dust (PDF)", url: "https://www.weather.gov/media/directives/010_pdfs/pd01005015curr.pdf" },
      { label: "NWS: Wireless Emergency Alerts", url: "https://www.weather.gov/wrn/wea" },
    ],
  },

  // ───────────────────────────── Satellite & radar ─────────────────────────────
  goes: {
    title: "GOES Satellites",
    group: "satellite-radar",
    icon: "🛰️",
    summary: "NOAA's geostationary weather satellites, 22,236 miles above the equator, imaging the Americas every 5–10 minutes and storm targets every 30–60 seconds.",
    body: [
      "GOES satellites orbit 22,236 miles (35,786 km) above the equator at the speed of Earth's rotation, so each holds a fixed view of its hemisphere. GOES-East is GOES-19, at 75.2°W since April 7, 2025; GOES-West is GOES-18, at 137.0°W since January 4, 2023. GOES-16 and GOES-17 serve as on-orbit backups. Together they cover from the west coast of Africa to New Zealand.",
      "The workhorse is the Advanced Baseline Imager (ABI): 16 spectral bands at 0.5–2 km resolution beneath the satellite. In its standard scan mode it images the full disk every 10 minutes, the CONUS (GOES-East) or PACUS (GOES-West) sector every 5 minutes, and two 1,000 × 1,000 km mesoscale sectors every 60 seconds—or one sector every 30 seconds.",
      "The Geostationary Lightning Mapper (GLM) maps total lightning—in-cloud and cloud-to-ground—day and night; surging flash rates often accompany strengthening updrafts. Two caveats: resolution degrades away from the sub-satellite point, and parallax displaces tall clouds away from it, so satellite storm tops can sit miles from their radar cores.",
    ],
    lookFor: [
      "Which satellite you're viewing: GOES-East for the central and eastern U.S. and Atlantic, GOES-West for the West, Alaska, Hawaii and Pacific.",
      "Scan cadence in the timestamps: 1-minute mesoscale loops versus 5-minute CONUS frames.",
      "GLM flash-extent density jumping in a storm's core—a lightning surge that often accompanies a strengthening updraft.",
      "Parallax: tall storms over the central U.S. appear displaced north and west of their radar position on GOES-East imagery.",
    ],
    related: ["mesoscale-sectors", "satellite-bands", "geocolor", "overshooting-tops"],
    sources: [
      { label: "NESDIS: Geostationary satellites (GOES-R Series)", url: "https://www.nesdis.noaa.gov/our-satellites/currently-flying/geostationary-satellites" },
      { label: "NESDIS: Advanced Baseline Imager", url: "https://www.nesdis.noaa.gov/our-satellites/currently-flying/goes-east-west/advanced-baseline-imager-abi" },
      { label: "NOAA OSPO: GOES spacecraft status", url: "https://www.ospo.noaa.gov/operations/goes/status.html" },
    ],
  },

  "mesoscale-sectors": {
    title: "GOES Mesoscale Sectors",
    group: "satellite-radar",
    icon: "⏱️",
    summary: "Two movable 1,000-km boxes per satellite scanned every minute; where NOAA puts them tells you where forecasters expect the day's high-impact weather.",
    body: [
      "Each GOES Advanced Baseline Imager scans two mesoscale domain sectors, about 1,000 × 1,000 km at the sub-satellite point, every 60 seconds alongside its routine full-disk and CONUS scans; if both are placed on the same spot, that area is imaged every 30 seconds. With GOES-East and GOES-West, four movable sectors are available at any time.",
      "Placement is requested, not automatic. NWS forecast offices and national centers such as SPC and NHC submit requests through NOAA's satellite operations, which schedules them by a ranked priority list tied to the hazard. A June 2026 SPC request, for example, was logged as 'Priority 7, SPC Enhanced Risk'. A higher-ranked request can bump a lower one, research requests yield to operational needs, and with no requests the sectors sit at default positions.",
      "That makes the sectors a signal. A meso box parked over Oklahoma at noon says SPC or a local office expects convection worth watching minute by minute; a box centered on a tropical system or a large wildfire says the same about that hazard. One-minute imagery reveals what five-minute loops miss: growing cumulus towers, pulsing overshooting tops, colliding outflow boundaries.",
    ],
    lookFor: [
      "'Meso-1' and 'Meso-2' labels on GOES-East and GOES-West imagery—note where each box sits and when it moves.",
      "NOAA's TOWR-S Meso View, which lists active sector requests with requester and reason.",
      "A sector hopping between hazards during the day, from morning fog or fire to afternoon convection.",
      "One-minute loops of cumulus fields along boundaries—often the earliest sign of initiation, before radar echoes appear.",
    ],
    related: ["goes", "overshooting-tops", "satellite-bands", "spc-outlook"],
    sources: [
      { label: "NESDIS: ABI scan modes and channel summary", url: "https://www.nesdis.noaa.gov/our-satellites/currently-flying/goes-east-west/abi-scan-mode-information-and-channel-summary" },
      { label: "CIMSS: GOES mesoscale sectors — requests and default positions", url: "https://cimss.ssec.wisc.edu/satellite-blog/archives/23225" },
      { label: "NOAA VLab TOWR-S: Meso View (active sector requests)", url: "https://vlab.noaa.gov/web/towr-s/mmm/meso-view" },
    ],
  },

  "satellite-bands": {
    title: "Visible, IR & Water Vapor",
    group: "satellite-radar",
    icon: "🌈",
    summary: "Visible shows reflected sunlight, infrared shows emitted heat—cloud-top temperature—and water vapor shows moisture in the middle and upper troposphere.",
    body: [
      "Visible bands (ABI band 2, 0.64 µm, at 0.5 km—the sharpest on GOES) measure reflected sunlight, so they show texture: cumulus fields, overshooting tops, gravity waves, fog, snow cover and smoke. They go dark at night. Near-infrared bands extend this, separating snow and ice from liquid cloud (1.6 µm) and flagging thin cirrus (1.37 µm).",
      "Infrared window bands, such as the 'clean' 10.3 µm band, measure emitted radiation converted to brightness temperature. Because temperature falls with height in the troposphere, colder means higher: tops of −60°C or colder mark deep convection near the tropopause. IR works day and night and tracks storm tops, but low clouds and fog can match the ground's temperature and vanish.",
      "Water vapor bands (6.2, 6.9 and 7.3 µm) sit where vapor absorbs strongly, so the satellite senses radiation from moisture in a layer, not the surface. In the usual enhancement, moist layers look cold and bright and dry air warm and dark. The low-level band sees deepest—down to roughly 750 mb in dry air. Water vapor imagery reveals jet streams, troughs, dry slots and turbulence in cloud-free air.",
    ],
    lookFor: [
      "Visible loops for texture and motion: towering cumulus along boundaries, spreading anvils, shadows from overshooting tops at low sun.",
      "IR color tables: the coldest tops and how fast they expand, cool or warm.",
      "Water vapor: dark dry slots wrapping into cyclones, sharp moisture edges along jet streaks, an atmospheric river's plume.",
      "RGB composites such as GeoColor, Sandwich or Air Mass, each blending bands to answer a specific question.",
    ],
    related: ["goes", "geocolor", "overshooting-tops", "atmospheric-river"],
    sources: [
      { label: "NESDIS: ABI scan modes and channel summary", url: "https://www.nesdis.noaa.gov/our-satellites/currently-flying/goes-east-west/abi-scan-mode-information-and-channel-summary" },
      { label: "NOAA JetStream: GOES-East imagery bands", url: "https://www.noaa.gov/jetstream/goes_east" },
    ],
  },

  geocolor: {
    title: "GeoColor",
    group: "satellite-radar",
    icon: "🌍",
    summary: "CIRA's blended GOES product: simulated true color by day, infrared-based low and high clouds over static city lights by night.",
    body: [
      "GOES-R satellites have no green channel, so true color must be built. GeoColor, developed at NOAA's Cooperative Institute for Research in the Atmosphere (CIRA), takes the blue (0.47 µm), red (0.64 µm) and near-infrared 'veggie' (0.86 µm) bands, corrects them for Rayleigh scattering to boost contrast, and synthesizes green with a lookup table built from Japan's Himawari imager, which does have a green band.",
      "At night it switches to infrared. Over land, the 10.3 µm window and the 10.3–3.9 µm 'fog' difference separate low liquid-water clouds, shown light blue, from higher ice clouds in gray and white, drawn partly transparent over city lights. Over the ocean, a machine-learning low-cloud product (ProxyVis) is used. A 2025 update narrowed the day–night transition, extending the daytime look by up to an hour at dawn and dusk.",
      "Know the limits. The city lights are a static database from the VIIRS Day/Night Band, so power outages never appear. Shallow water colors can be noisy, thick low clouds can look semi-transparent at night, and features may briefly change color near sunrise and sunset. For quantitative work—cloud-top temperature, moisture—go to the individual bands.",
    ],
    lookFor: [
      "Smoke (bluish gray) versus blowing dust (light brown or tan) in daytime frames.",
      "Nighttime light-blue patches marking fog and stratus spreading through valleys and along coasts.",
      "The twilight transition sweeping across the image—cloud colors there aren't reliable.",
      "GLM lightning overlays for context, then a switch to IR or visible bands for detail.",
    ],
    related: ["goes", "satellite-bands", "haboob", "red-flag-warning"],
    sources: [
      { label: "CIRA/NOAA RAMMB: GeoColor product quick guide (PDF)", url: "https://rammb2.cira.colostate.edu/wp-content/uploads/2020/01/QuickGuide_CIRA_GeoColor_2025update.pdf" },
      { label: "NOAA JetStream: GOES-East imagery and true color", url: "https://www.noaa.gov/jetstream/goes_east" },
      { label: "NESDIS STAR: GOES image viewer", url: "https://www.star.nesdis.noaa.gov/GOES/index.php" },
    ],
  },

  "overshooting-tops": {
    title: "Overshooting Tops & Anvil Plumes",
    group: "satellite-radar",
    icon: "⛰️",
    summary: "Satellite fingerprints of strong updrafts punching through the tropopause—domes, plumes and enhanced-V patterns that flag storms likely to be severe.",
    body: [
      "An overshooting top is a dome-like protrusion above a thunderstorm's anvil, where an updraft's momentum carries it past its equilibrium level and often into the lower stratosphere. It marks the strongest updraft in the storm. In visible imagery it is a lumpy, cauliflower bubble casting a shadow at low sun angles; in infrared it is a small cold spot, colder than the surrounding anvil. A persistent one often signals a supercell.",
      "Strong overshooting updrafts can generate an above-anvil cirrus plume (AACP): ice lofted into the lower stratosphere and carried downwind like smoke from a chimney. Because temperature rises with height above the tropopause, the plume usually reads warmer than the anvil in IR (cold plumes do occur), producing the classic enhanced-V—cold arms wrapping a warmer wake downwind of the overshooting top. Plumes are often easiest to spot in visible loops.",
      "The signal is strong. In a study of more than 4,500 storms, plume storms produced about 14 times as many severe reports as storms without plumes; 59% of plume storms were severe, about three-quarters of supercells produced plumes, and plumes often appeared within about 10 minutes before the first warning. One-minute mesoscale imagery is best for catching them.",
    ],
    lookFor: [
      "Visible: bubbling, shadow-casting domes above a smooth anvil, and a smoky plume streaming downwind from the dome.",
      "IR: a small cold spot at the upwind end of the anvil with a warm wake or V-shaped pattern downwind.",
      "Persistence: a long-lived overshooting top suggests a supercell; tops that pulse and collapse suggest pulse or cyclic storms.",
      "Parallax: on GOES-East, central-U.S. storm tops appear displaced northwest of the radar core—sometimes by a county or more.",
    ],
    related: ["supercell", "goes", "mesoscale-sectors", "satellite-bands", "hail"],
    sources: [
      { label: "NWS Spotter Glossary: Overshooting top", url: "https://www.weather.gov/spotterguide/glossary_o" },
      { label: "NESDIS: Advanced Baseline Imager — severe storm signatures", url: "https://www.nesdis.noaa.gov/our-satellites/currently-flying/goes-east-west/advanced-baseline-imager-abi" },
      { label: "CIRA/NOAA RAMMB: Above-anvil cirrus plume training (PDF)", url: "https://ramsdis.cira.colostate.edu/rammb/training/visit/training_sessions/above_anvil_cirrus_plumes/AACP_TalkingPoints_2024.pdf" },
    ],
  },

  "radar-reflectivity": {
    title: "Radar Reflectivity",
    group: "satellite-radar",
    icon: "📡",
    summary: "How much transmitted energy comes back from precipitation, on a logarithmic dBZ scale—dominated by the biggest targets, from raindrops to hail.",
    body: [
      "The 160-radar WSR-88D (NEXRAD) network, run jointly by the NWS, FAA and Department of Defense, transmits pulses of about 750,000 watts and measures the tiny fraction that returns. Raw reflectivity spans many orders of magnitude, so it is expressed logarithmically in dBZ. Because returned power scales with drop diameter to the sixth power, one 3 mm drop returns as much as 729 1 mm drops—so dBZ is not rain rate.",
      "As rough guides: 20–40 dBZ is light precipitation, 40–50 moderate, 50–65 heavy rain or some hail, and above 65 extremely heavy precipitation including water-coated hail. Exceptions matter: tropical rain with small drops can be torrential at only 35–45 dBZ. Base reflectivity is the lowest (0.5°) scan and shows low-level structure; composite reflectivity takes the maximum from all tilts and reveals cores aloft but masks hooks and boundaries.",
      "The beam climbs with distance—about 12,000 feet above ground at 100 miles for the 0.5° tilt—so distant radars overshoot shallow snow bands and low-level rotation. In severe weather, VCP 12 or 212 scans 14 elevation angles in about 4½ minutes, and MESO-SAILS can insert extra 0.5° scans, refreshing the lowest tilt as often as every 75 seconds.",
    ],
    lookFor: [
      "Hook echoes, inflow notches and bounded weak echo regions (check several tilts) in supercells.",
      "Bow echoes with rear-inflow notches, and training echoes moving repeatedly over the same area.",
      "A three-body scatter spike—a radial streak of weak echo behind a hail core—and 60+ dBZ cores well above the freezing level.",
      "Non-weather echoes—ground clutter, birds and insects at dusk, smoke and dust—which correlation coefficient helps sort out.",
    ],
    related: ["velocity-couplet", "debris-signature", "hail", "supercell", "qlcs"],
    sources: [
      { label: "NOAA JetStream: Reflectivity", url: "https://www.noaa.gov/jetstream/reflectivity" },
      { label: "NOAA JetStream: Volume coverage patterns", url: "https://www.noaa.gov/jetstream/vcp_max" },
      { label: "NWS: MESO-SAILS faster low-level radar scans", url: "https://www.weather.gov/news/151509-meso-sails" },
    ],
  },

  "velocity-couplet": {
    title: "Velocity Couplet",
    group: "satellite-radar",
    icon: "↔️",
    summary: "Adjacent strong inbound and outbound Doppler velocities—the radar signature of rotation, from broad mesocyclones to tight, tornado-scale vortices.",
    body: [
      "Doppler radar measures only radial velocity—motion toward (negative, usually green) or away from (positive, red) the radar. A rotating column always has some flow toward and away from the beam, so rotation appears as a couplet: an inbound maximum beside an outbound maximum at about the same range, on adjacent radials. Convergence or divergence instead lines up along a single radial.",
      "Strength is judged by rotational velocity, Vrot—half the difference between the peak outbound and inbound velocities—and by tightness. A broad couplet a few miles across is a mesocyclone; when strong opposite velocities sit in neighboring gates (gate-to-gate shear), the rotation is compact and intense: a tornadic vortex signature. Forecasters want vertical continuity through several tilts and persistence over successive scans.",
      "Three cautions. Storm motion contaminates base velocity—use storm-relative velocity to see rotation in fast-moving storms. The beam rises and widens with range (about 12,000 feet up at 100 miles), so distant couplets are sampled aloft and smeared out. And velocities alias when they exceed the Nyquist limit, producing sharp color flips that can mimic couplets.",
    ],
    lookFor: [
      "Storm-relative velocity at the lowest tilt: a tight couplet near the hook tip that strengthens and contracts scan to scan.",
      "Vertical continuity through the lowest several tilts, with the couplet building downward toward the ground.",
      "MRMS rotation tracks (azimuthal shear) mapping where the strongest rotation passed.",
      "Aliasing and range folding (often shaded purple) that can fake or hide a couplet; cross-check with reflectivity structure.",
    ],
    related: ["debris-signature", "tornado-warning", "supercell", "qlcs", "radar-reflectivity"],
    sources: [
      { label: "NOAA JetStream: Velocity", url: "https://www.noaa.gov/jetstream/velocity" },
      { label: "NSSL: Severe Weather 101 — tornado detection", url: "https://www.nssl.noaa.gov/education/svrwx101/tornadoes/detection/" },
    ],
  },

  "debris-signature": {
    title: "Tornadic Debris Signature",
    group: "satellite-radar",
    icon: "🪵",
    summary: "Dual-polarization evidence of lofted debris—low correlation coefficient inside a reflectivity maximum on a strong velocity couplet—confirming a damaging tornado.",
    body: [
      "Since the 2012 dual-polarization upgrade, WSR-88Ds transmit horizontally and vertically polarized pulses. Correlation coefficient (CC) measures how similarly the two behave in a sampling volume. Uniform rain or snow scores above about 0.97; mixed precipitation such as hail falls lower; non-meteorological targets—insects, smoke and especially tornado debris, with its random shapes, sizes and tumbling—drop below about 0.80.",
      "A TDS is that low CC co-located with a strong storm-relative velocity couplet and reflectivity above roughly 30 dBZ—often a 'debris ball' at the tip of a hook—with differential reflectivity near 0 dB. It means a tornado is on the ground and lofting debris, which is why it can justify a 'TORNADO...OBSERVED' tag or, in extreme cases, a Tornado Emergency, especially at night when spotters can't see.",
      "It confirms rather than predicts: debris must already be airborne, so a TDS offers no lead time for the first touchdown, though it tracks the tornado afterward. Weak tornadoes, tornadoes crossing open country with little to loft, and storms far from the radar may show no TDS. Strong tornadoes can loft debris 20,000–30,000 feet, and the signature can linger briefly after the tornado weakens as debris falls out.",
    ],
    lookFor: [
      "A compact area of CC below about 0.80—often near 0.7 or lower in strong tornadoes—sitting exactly on the couplet, not at the storm's ragged edges.",
      "Vertical extent: the low-CC column appearing on higher tilts as the tornado strengthens.",
      "ZDR near 0 dB inside the low-CC area, and a reflectivity 'debris ball' at the hook tip.",
      "Impostors: low CC from weak signal at echo edges, hail cores (0.70–0.95), smoke plumes and biological echoes—none paired with a tight couplet.",
    ],
    related: ["velocity-couplet", "tornado-warning", "tornado-emergency", "radar-reflectivity", "ef-scale"],
    sources: [
      { label: "NOAA JetStream: How radar works — dual polarization", url: "https://www.noaa.gov/jetstream/doppler/how-radar-works" },
      { label: "NSSL: Severe Weather 101 — tornado detection", url: "https://www.nssl.noaa.gov/education/svrwx101/tornadoes/detection/" },
      { label: "NWS Albany: Dual-polarization interpretation (PDF)", url: "https://www.weather.gov/media/aly/LocalResearch/Online%20LocalResearch/SUNY_Course/Presentations/Presentations_2022/Dual%20Polarization%20Interpretation_TAW_BJF_2022.pdf" },
    ],
  },
};

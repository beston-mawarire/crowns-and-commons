// The legislation catalogue.
//
// Names and descriptions are written in plain modern English so anyone can follow them.
// Each law has a public face (name + the benefit players are shown) and a hidden side:
//   w    - how much each group likes it, -3..+3, in order Co Me Ar Cl Mi No
//   down - the downside, revealed only through the news ticker and at the end of a match
//   d    - how the downside bites later in the count (same scale as w)
//   tags - used by random events and the "unfunded promises" rule
//
// Within a category the laws run along a spectrum; `pos` is the position on it.
// Balance lives entirely in this file and in MODEL (data.ts): retune here, not in code.

import { GROUP_KEYS, type GroupKey, type W } from "./data";

export interface Law {
  id: string;
  tier: "R" | "N";
  cat: number;
  pos: number;
  name: string;
  desc: string;
  w: W;
  down: string;
  d: W;
  tags: string[];
}

export interface PublicLaw {
  id: string;
  tier: "R" | "N";
  cat: number;
  pos: number;
  name: string;
  desc: string;
}

type D = Partial<Record<GroupKey, number>>;
const raw: [string, string, string, W, string, D, string?][] = [
  // ---- 1 Economy & ownership: shared ownership -> private ownership
  ["R1.1", "Shared Workshops", "Workshops and mills belong to everyone, and the workers share what they make.", [2, -3, -1, 0, 0, -3], "People stop pulling their weight and goods run short.", { Co: -1, Ar: -1 }],
  ["R1.2", "Town-Run Mills & Bakeries", "The town runs the mills and ovens and charges a low, fixed fee.", [1, -1, 0, 0, 0, -2], "Long queues, broken equipment, and the fees slowly go up.", { Co: -1 }, "spend"],
  ["R1.3", "Fixed Bread Prices", "Bread prices are tied to grain prices, so bakers can't overcharge.", [2, -1, -1, 1, 0, 0], "Bakers make smaller loaves, and shops run out in bad months.", { Co: -1, Ar: -1 }, "grain"],
  ["R1.4", "Guild Licences", "Only licensed craft guilds may make and sell goods, which keeps quality high.", [-1, -1, 3, 1, 0, 0], "The guilds shut out newcomers and prices go up.", { Co: -1, Me: -1 }],
  ["R1.5", "Trade Monopoly", "One big company gets the only right to use a rich trade route, and pays the region well for it.", [-1, 2, -1, 0, 0, 1], "With no competition it charges what it likes, and it buys influence over the council.", { Co: -1, Ar: -1 }, "trade"],
  ["R1.6", "Open Business Law", "Anyone can open a workshop and sell what they make.", [1, 2, -3, 0, 0, 0], "Experienced craft workers lose income, and cheap, poor-quality goods flood the market.", { Ar: -1, Co: -1 }],
  ["R1.7", "Public Land Sale", "Sell off shared public land for a big one-off payment.", [-2, 3, 0, -1, 0, 2], "The money is soon spent, and the free grazing land is gone for good.", { Co: -2 }],

  ["N1.1", "State-Owned Mines & Forests", "Mines and forests belong to the state, and the profits pay for public needs.", [2, -3, -1, 0, 1, -3], "State businesses are run badly, and jobs go to friends of the powerful.", { Co: -1, Mi: -1 }],
  ["N1.2", "State Salt & Iron Monopoly", "Only the state may sell salt and iron, at one steady price.", [-2, -2, -1, 0, 1, 1], "Smuggling takes off and people riot over the price of salt.", { Co: -1, Mi: -1 }],
  ["N1.3", "National Trade Rules", "One set of rules for every craft and trade, the same in every town.", [-1, -1, 2, 1, 0, 1], "Trades can't adapt, and skilled workers run short.", { Me: -1, Ar: -1 }],
  ["N1.4", "One Currency & Measures Act", "One currency and one system of weights and measures for the whole country.", [1, 2, 1, 0, 0, -1], "Nobles lose the income from their own coins and tolls, and they don't forget it.", { No: -2 }, "trade"],
  ["N1.5", "Free Business Charter", "Anyone may do any job or trade, anywhere in the country.", [0, 3, -2, 0, 0, 1], "The guilds collapse and the gap between rich and poor grows.", { Ar: -1, Co: -1 }, "trade"],
  ["N1.6", "Sale of State Lands", "Sell the state's lands and pay off the national debt in one go.", [-2, 2, 0, -1, -1, 3], "The state earns less afterwards, so taxes go up to cover it.", { Co: -1, Mi: -1 }],

  // ---- 2 Taxes: the rich pay more -> everyone pays the same
  ["R2.1", "Wealth Tax", "A tax on the biggest fortunes, shared out among the poor.", [3, -2, 0, 0, 0, -3], "The rich hide their money or move it away.", { Me: -1, Co: -1 }],
  ["R2.2", "Big House Tax", "The bigger your house, the more tax you pay.", [2, -1, 0, 0, 0, -2], "People brick up rooms and fireplaces to make their homes look smaller.", { Co: -1 }],
  ["R2.3", "Luxury Tax", "Tax silk and wine, never bread.", [1, -2, -1, 1, 0, -2], "Smuggling grows, and makers of fine goods lose work.", { Ar: -1 }],
  ["R2.4", "Flat Property Tax", "Everyone pays the same simple rate on what they own.", [-1, 0, 0, 0, 0, 1], "The records go out of date, and new wealth isn't taxed.", { Co: -1 }],
  ["R2.5", "Beer & Salt Tax", "A small tax on everyday goods that hardly anyone notices.", [-2, -1, -1, 0, 1, 2], "The poor end up paying the most, and tax collectors get chased through the streets.", { Co: -1, Ar: -1 }],
  ["R2.6", "Private Tax Collectors", "Bankers pay the year's taxes up front, then collect the money from people themselves.", [-2, 2, -1, -1, 0, 1], "The collectors squeeze people for double and keep the difference.", { Co: -1, Ar: -1 }],
  ["R2.7", "Per-Person Tax", "Every adult pays the same amount. Simple and equal.", [-3, 1, -1, 0, 0, 2], "Poor families hide relatives from the count, and there is talk of revolt.", { Co: -2, Mi: -1 }],

  ["N2.1", "National Wealth Tax & Benefits", "Big fortunes pay for regular support payments to every poor household.", [3, -2, 1, 0, 0, -3], "Wealth leaves the country and tax inspectors take bribes.", { Me: -1, Co: -1 }],
  ["N2.2", "Income Tax", "Everyone pays according to what they earn.", [2, -1, 1, 0, 0, -2], "Officials dig through everyone's private accounts.", { Me: -1, Ar: -1 }],
  ["N2.3", "End of Tax Exemptions", "Nobles and the church lose their tax-free status.", [2, 1, 1, -3, 0, -3], "Church leaders and nobles join forces against the party.", { Cl: -1, No: -1 }, "secular"],
  ["N2.4", "Land Tax", "One clear tax, charged only on land.", [1, 1, 1, -1, 0, -2], "Landlords pass the cost on by raising rents.", { Co: -2 }],
  ["N2.5", "Sales & Import Taxes", "Taxes are collected only at ports and markets.", [-2, -1, -1, 0, 1, 2], "Bread and beer cost more, and smuggling booms.", { Co: -1, Me: -1 }],
  ["N2.6", "Abolition of Direct Taxes", "No tax collector will ever come to your door again.", [-1, 2, 1, -1, -2, 3], "Soldiers and shelters for the poor go unpaid.", { Mi: -2, Co: -1 }],

  // ---- 3 Jobs & wages: workers protected -> employers in control
  ["R3.1", "Worker-Run Workshops", "Workers run their workshops together and share the profits.", [3, -2, 1, 0, 0, -2], "Workshops run short of money and argue over every decision.", { Ar: -1, Co: -1 }],
  ["R3.2", "Public Works Jobs", "People without work are paid to build walls, roads and bridges.", [2, -1, 0, 1, 1, -1], "It is expensive, and private employers hire less.", { Me: -1, Ar: -1 }, "spend"],
  ["R3.3", "Minimum Wage", "Judges set a fair minimum wage every year.", [2, -1, -1, 1, 0, -1], "Employers hire fewer people.", { Co: -1, Ar: -1 }],
  ["R3.4", "Rest Days", "No work on religious holidays or after dark.", [2, -1, 0, 2, 0, -1], "Less gets made, and orders arrive late.", { Me: -1, Ar: -1 }, "church"],
  ["R3.5", "Seven-Year Training Rule", "Every craft worker must finish a full apprenticeship before working alone.", [-1, -1, 2, 0, 0, 1], "There aren't enough workers, and young people wait years to earn a living.", { Co: -1, Me: -1 }],
  ["R3.6", "Free Hiring", "Employers and workers agree wages between themselves.", [-1, 3, -2, 0, 0, 1], "Wages swing up and down with every season.", { Co: -2 }],
  ["R3.7", "Wage Cap", "Wages are held at the old, traditional levels.", [-3, 1, -1, 0, 0, 3], "Workers leave for better pay elsewhere, and anger builds.", { Co: -1, No: -1 }],

  ["N3.1", "Job Guarantee", "State workshops guarantee a job to anyone who wants one.", [3, -2, 0, 0, 0, -2], "Costs balloon, and closing the workshops would cause riots.", { Me: -1, Co: -1 }, "spend"],
  ["N3.2", "National Minimum Wage", "One minimum wage for the whole country.", [2, -1, 0, 1, 0, -1], "Poor country employers can't afford it.", { Co: -1, No: -1 }],
  ["N3.3", "Freedom for Serfs", "Every peasant who is tied to a noble's land is set free.", [3, 1, 1, 0, 0, -3], "The freed peasants owe compensation payments for a generation.", { Co: -2 }],
  ["N3.4", "Freedom to Move for Work", "Anyone may look for work in any town.", [1, 2, -1, 0, 0, -1], "Villages empty and towns become overcrowded.", { No: -1, Ar: -1 }],
  ["N3.5", "Strike Ban", "No strikes and no worker unions: steady work for steady pay.", [-2, 2, -2, 0, 1, 2], "Workers organise in secret, and the unrest goes underground.", { Ar: -1, Mi: -1 }],
  ["N3.6", "National Wage Cap", "Wages are capped at traditional rates across the country.", [-3, 1, -1, 0, 0, 3], "People ignore it everywhere, and revolt is in the air.", { Co: -1, Mi: -1 }],

  // ---- 4 Trade: controlled -> open
  ["R4.1", "Price Cap", "A maximum price for bread, salt and firewood.", [2, -3, -1, 0, 1, -1], "Goods vanish from the shops and reappear on the black market.", { Co: -2 }, "grain"],
  ["R4.2", "Grain Export Ban", "Our grain stays here to feed our own people.", [2, -2, 0, 1, 0, -2], "Farmers grow less, and neighbouring regions hit back.", { Co: -1, Me: -1 }, "grain"],
  ["R4.3", "Import Tax on Cloth", "A tax on foreign cloth protects local weavers.", [-1, -1, 3, 0, 0, 1], "Cloth gets expensive, and foreign ports hit back.", { Co: -1, Me: -1 }],
  ["R4.4", "Single Wool Market", "All wool must be sold through one official, well-run market.", [-1, 1, 0, 0, 0, 1], "Transport costs rise, and wool is sold illegally elsewhere.", { Me: -1 }, "trade"],
  ["R4.5", "Market & Fair Licence", "A weekly market and a big fair every year.", [1, 2, 1, 1, 0, 1], "Stall fees creep up and rival towns get jealous.", { Me: -1 }, "trade"],
  ["R4.6", "Fast Trade Courts", "Special courts settle business disputes within days.", [-1, 3, 1, 0, 0, 0], "People in debt have their belongings seized the same day.", { Co: -1, Ar: -1 }, "trade"],
  ["R4.7", "Tax-Free Port", "No fees or taxes at the port: every ship is welcome.", [1, 3, -2, 0, -1, -1], "The region loses its port income, and cheap imports undercut local makers.", { Ar: -1, Mi: -1 }, "trade"],

  ["N4.1", "National Food Reserve", "The state buys grain in good years and sells it cheaply in bad years.", [3, -2, 0, 1, 1, -1], "It is expensive, and the officials in charge get rich.", { Me: -1, Co: -1 }, "spend grain"],
  ["N4.2", "Grain Import Tax", "A tax on foreign grain keeps our farms profitable.", [-3, -2, -1, 0, 0, 3], "Bread gets expensive and the towns get angry.", { Co: -1, Ar: -1 }],
  ["N4.3", "Protected Trade System", "Tax imports and reward exports: sell a lot abroad, buy little.", [-1, 1, 2, 0, 1, 1], "Other countries hit back, and smuggling grows at home.", { Me: -2 }, "trade"],
  ["N4.4", "Single National Market", "No tolls or fees for moving goods between regions.", [1, 3, 0, 0, 0, -2], "Nobles who owned the tolls lose a fortune.", { No: -1 }, "trade"],
  ["N4.5", "Free Trade Agreement", "Open our ports to goods from every country.", [2, 3, -2, 0, 0, -3], "Local farms and workshops can't compete on price.", { Ar: -1, No: -1 }, "trade"],

  // ---- 5 Welfare: help for everyone -> private charity
  ["R5.1", "Free Daily Meals", "A free meal every day for anyone who comes.", [3, -2, 0, 1, 0, -2], "It costs a fortune, and hungry people arrive from other regions.", { Me: -1, Co: -1 }, "spend grain"],
  ["R5.2", "Free Town Doctor", "A paid town doctor, and free care for the sick.", [2, -1, 1, 0, 1, -1], "It is expensive, and quarantines shut the markets.", { Me: -1 }, "spend health"],
  ["R5.3", "Local Poor Tax", "Each community supports its own poor from a local tax.", [2, -1, 0, 1, 0, -1], "Taxpayers struggle with the cost.", { Ar: -1, Me: -1 }, "spend grain"],
  ["R5.4", "Church Charity", "The church hands out food and money to the poor.", [1, 0, 0, 2, 0, 0], "Help reaches some communities and never reaches others.", { Co: -1 }, "church"],
  ["R5.5", "Guild Support Funds", "The guilds look after their own sick members and widows.", [-1, 1, 2, 0, 0, 0], "People outside the guilds get nothing.", { Co: -1 }],
  ["R5.6", "Work-for-Aid Houses", "The poor get help, but only by living and working in a workhouse.", [-2, 1, 0, 0, 0, 1], "Life inside is miserable, and there are riots at the gates.", { Co: -1, Cl: -1 }],
  ["R5.7", "Private Charity Rule", "No poor tax at all: helping the poor is left to private giving.", [-3, 2, 0, 0, 0, 2], "Homelessness, theft and sickness spread.", { Co: -1, Ar: -1 }],

  ["N5.1", "National Food Guarantee", "Nobody in the country is allowed to starve.", [3, -2, 0, -1, 0, -2], "It costs a huge amount, and it pushes the church's charity aside.", { Me: -1, Cl: -1 }, "spend grain"],
  ["N5.2", "National Health Officers", "Health officers in every port and town.", [2, -1, 0, 0, 1, 0], "It is expensive, and ports and fairs get shut down over rumours.", { Me: -1 }, "spend health"],
  ["N5.3", "Schools for All Act", "A school in every community: reading and maths for every child.", [2, 1, 1, 1, 0, -1], "It is expensive, and newly educated people start asking hard questions.", { No: -1, Cl: -1 }, "spend"],
  ["N5.4", "National Poor Support", "The same local support for the poor in every part of the country.", [2, -1, 0, 1, 0, -1], "Taxpayers revolt.", { Ar: -1, Me: -1 }, "spend grain"],
  ["N5.5", "National Workhouse Law", "Help is available everywhere, but only through workhouses.", [-2, 1, 0, 0, 0, 1], "Misery and riots.", { Co: -1, Cl: -1 }],
  ["N5.6", "End of Public Aid", "No more public aid, and no more taxes to pay for it.", [-3, 2, 0, 0, 0, 2], "Homelessness and disorder on every road.", { Co: -1, Mi: -1 }],

  // ---- 6 Land: shared land -> big private estates
  ["R6.1", "Land for Farmers", "Nobles' fields are handed to the people who farm them.", [3, 0, 0, -1, 0, -3], "Harvests drop while the new owners find their feet.", { Co: -1, Me: -1 }],
  ["R6.2", "Protected Shared Land", "Everyone keeps the right to graze animals and gather wood on shared land, for good.", [2, -1, 0, 1, 0, -2], "The shared land gets overused and worn out.", { Co: -1 }],
  ["R6.3", "Rent Freeze", "Rents are frozen at today's level.", [2, -1, 0, 0, 0, -2], "Landlords stop repairing roofs and drains.", { Co: -1 }],
  ["R6.4", "Traditional Farming Rule", "Keep farming the way our grandparents did.", [1, 0, 0, 1, 0, 1], "Harvests never get any better.", { Me: -1, Co: -1 }],
  ["R6.5", "Grain Bonus", "Farmers are paid a bonus for every sack of grain they sell.", [-1, 0, 0, 0, 0, 2], "It is expensive, and bread at home costs more.", { Co: -1, Ar: -1 }],
  ["R6.6", "Open Land Market", "Land can be bought and sold like anything else.", [-1, 3, 0, 0, 0, -1], "Speculators buy up whole villages.", { Co: -1, No: -1 }],
  ["R6.7", "Fencing of Shared Land", "Nobles may fence off shared land and farm it more efficiently.", [-3, 1, 0, 0, 0, 3], "Poor families are pushed off the land, and fences get torn down at night.", { Co: -1, Mi: -1 }],

  ["N6.1", "National Land Reform", "Land is shared out more fairly across the whole country.", [3, 0, 0, -2, 0, -3], "Harvests drop and nobles resist with force.", { Co: -1, Mi: -1 }],
  ["N6.2", "National Shared Land Rights", "Shared land rights are restored in every forest and field.", [3, -1, 0, 0, 0, -2], "The land stays poor and unimproved.", { Me: -1, Co: -1 }],
  ["N6.3", "Buy-Your-Freedom Scheme", "Peasants can pay to be freed from the unpaid work they owe to nobles.", [2, 1, 0, -1, 0, -2], "Peasants go deep into debt to pay for their freedom.", { Co: -2 }],
  ["N6.4", "Farming Board", "Better drainage, new crops and better ploughs.", [0, 1, 0, 0, 0, 2], "Most of the gains go to the biggest estates.", { Co: -1 }],
  ["N6.5", "Free Land Market", "Old rules that kept estates in one family are scrapped: land goes to whoever pays.", [0, 3, 0, 0, 0, -2], "Old estates are broken up and sold off.", { No: -1, Co: -1 }],
  ["N6.6", "National Fencing Law", "Shared fields everywhere are fenced off and made private, by law.", [-3, 1, 0, 0, 0, 3], "Huge numbers of people lose their homes and take to the roads.", { Co: -1, Ar: -1 }],

  // ---- 7 Government: ruled from the top -> people decide
  ["R7.1", "Appointed Governor", "One strong governor, sent from the capital, runs the whole region.", [-1, -1, -1, 0, 2, -2], "Decisions are made by a stranger who doesn't know the place.", { Co: -1, Me: -1 }, "spend order"],
  ["R7.2", "Paid Professional Officials", "Government jobs go to people who pass an exam, and can't be bought.", [1, 1, 0, 0, 0, -2], "A growing wage bill and endless paperwork.", { Me: -1, Co: -1 }, "spend"],
  ["R7.3", "Property Survey", "Every home and field is counted, so everyone is taxed fairly.", [0, -1, 0, -1, 1, -1], "Every bit of hidden money is found and taxed.", { Me: -1, Co: -1 }],
  ["R7.4", "Advisory Council", "Church leaders, nobles and townspeople advise the government together.", [0, 1, 0, 1, 0, 1], "Nothing ever gets decided.", { Co: -1, Mi: -1 }],
  ["R7.5", "Noble Governor", "A powerful local noble keeps order in the region.", [-2, -1, 0, 0, 1, 3], "Jobs go to his relatives, and old family feuds flare up.", { Me: -1, Ar: -1 }, "order"],
  ["R7.6", "Elected Mayor", "Townspeople elect their own mayor.", [0, 3, 2, 0, 0, -2], "A handful of rich townspeople end up running everything.", { Co: -1, Ar: -1 }],
  ["R7.7", "Public Assembly", "Every household gets a vote at open public meetings.", [3, 0, 1, -1, -1, -2], "It is slow and noisy, and votes are bought with drinks.", { Me: -1, Ar: -1 }, "liberty"],

  ["N7.1", "Absolute Monarchy", "One ruler decides everything, quickly and firmly.", [-1, -1, -1, 1, 2, -1], "Nobody believes the law applies to the ruler.", { Me: -1, No: -1 }, "order"],
  ["N7.2", "National Treasury", "Honest national accounts, kept by trained officials.", [0, 1, 0, 0, 1, -2], "It is expensive, and the nobles are pushed aside.", { No: -1, Co: -1 }, "spend"],
  ["N7.3", "National Parliament", "Church, nobles and townspeople all sit in one parliament.", [0, 1, 1, 1, 0, 1], "Sessions end in deadlock.", { Co: -1, Mi: -1 }],
  ["N7.4", "Tax Consent Charter", "No new taxes without the agreement of the national council.", [0, 1, 0, 1, -1, 3], "Nobles block everything, and the state runs short of money.", { Co: -1, Mi: -1 }],
  ["N7.5", "Regional Self-Rule Pact", "Each region keeps its own laws and traditions.", [1, 0, 0, 0, -2, 1], "Nobody pays for defending the country as a whole.", { Mi: -1, Me: -1 }],
  ["N7.6", "Votes for All Households", "A national assembly elected by every household.", [3, 1, 1, -1, 0, -3], "Powerful groups buy the votes of whole towns.", { Me: -1, Ar: -1 }, "liberty"],

  // ---- 8 Justice & freedoms: strict order -> more freedom
  ["R8.1", "Night Curfew", "Town gates close at dusk and guards patrol the streets.", [-2, -1, -1, 0, 3, 1], "Night-time business dies and the pubs empty.", { Me: -1, Ar: -1 }, "order"],
  ["R8.2", "Nobles' Courts", "Each noble judges the people living on his land, close to home.", [-2, -1, 0, 0, 0, 3], "Justice depends on the noble's mood.", { Co: -1, Me: -1 }],
  ["R8.3", "Harsh Punishment Code", "Tough sentences to scare off thieves.", [-2, 1, 0, -1, 1, 2], "Juries refuse to convict rather than see a neighbour hanged.", { Me: -1, Cl: -1 }, "order"],
  ["R8.4", "Travelling Judges", "Royal judges travel around to hear every case.", [1, 1, 1, 0, 0, -1], "It is slow and expensive: cases wait a year.", { Co: -1, Me: -1 }],
  ["R8.5", "Trial by Jury", "Anyone accused of a crime is judged by ordinary people from their community.", [2, 1, 1, 0, 0, -1], "Juries let their friends off.", { Me: -1, No: -1 }, "liberty"],
  ["R8.6", "Free Press Act", "Anyone may print and put up posters and pamphlets.", [1, 1, 1, -2, -1, -1], "Lies and calls for rebellion appear on every wall.", { No: -1, Cl: -1 }, "liberty"],
  ["R8.7", "Fair Arrest & Free Assembly", "Nobody is jailed without a reason, and people may gather freely.", [2, 1, 2, 0, -2, -1], "Unrest becomes harder to stop.", { Mi: -1, No: -1 }, "liberty"],

  ["N8.1", "Military Rule & Informers", "Soldiers and a network of informers keep order across the country.", [-3, -2, -2, 0, 3, 1], "Neighbours report on neighbours, and trust collapses.", { Me: -1, Cl: -1 }, "order"],
  ["N8.2", "National Harsh Punishment Code", "The same tough penalties in every court.", [-2, 1, 0, -1, 1, 2], "Juries won't convict.", { Me: -1, Cl: -1 }, "order"],
  ["N8.3", "One National Court System", "One system of royal courts for everyone.", [1, 2, 1, -1, 0, -2], "The church and the nobles lose their own courts, and the fees that came with them.", { Cl: -1, No: -1 }],
  ["N8.4", "Fair Trial Charter", "A fair legal process for every free person.", [2, 1, 1, 0, -1, 1], "Justice slows to a crawl.", { Me: -1, Mi: -1 }, "liberty"],
  ["N8.5", "Bill of Rights", "Free speech, the right to complain to the government, and no cruel punishments.", [2, 2, 2, -1, -1, 0], "Powerful people are mocked in print.", { No: -1, Cl: -1 }, "liberty"],
  ["N8.6", "Ban on Torture & Executions", "No torture and no death penalty anywhere in the country.", [1, 0, 1, 1, -2, -1], "Every theft sets off a panic about crime.", { Me: -1, Co: -1 }, "liberty"],

  // ---- 9 Religion: one official church -> church and state separate
  ["R9.1", "One Religion Law", "Everyone must follow the same religion: one people, one faith.", [-1, -2, -2, 3, 0, 0], "Skilled people of other faiths pack up and leave.", { Ar: -1, Me: -1 }, "church"],
  ["R9.2", "Church Tax", "Everyone gives a tenth of their harvest to keep the church running.", [-2, -1, -1, 3, 0, -1], "Farmers come to hate paying it.", { Co: -1 }, "church"],
  ["R9.3", "Church Courts", "Priests accused of crimes are judged by the church, not by ordinary courts.", [-1, -1, 0, 3, 0, -1], "There is a scandal when a guilty priest walks free.", { Co: -1, No: -1 }, "church"],
  ["R9.4", "Church Schools & Charity Fund", "The council pays for church schools and church charity.", [1, 0, 1, 2, 0, 0], "It is expensive to keep going.", { Me: -1 }, "spend church"],
  ["R9.5", "Freedom of Religion Order", "People of other faiths may worship in peace.", [0, 2, 1, -2, 0, 0], "Arguments break out between religious groups.", { Co: -1, Cl: -1 }, "secular"],
  ["R9.6", "Tax on Church Land", "Church estates pay their fair share of tax.", [1, 1, 0, -3, 1, 1], "Church charity dries up.", { Co: -2 }, "secular"],
  ["R9.7", "Separation of Church & Council", "The church stays out of government, and government stays out of the church.", [0, 2, 1, -3, 0, -1], "The church's schools and shelters close.", { Co: -2 }, "secular"],

  ["N9.1", "Official State Church", "The church gets seats in the national council.", [0, -1, -1, 3, 1, 1], "Resentment among other faiths builds up out of sight.", { Ar: -1, Me: -1 }, "church"],
  ["N9.2", "National Church Tax", "The church tax is enforced in every community.", [-2, -1, -1, 3, 0, -1], "The countryside resents every payment.", { Co: -1 }, "church"],
  ["N9.3", "Church and State Agreement", "State and church make a deal: the ruler chooses the bishops.", [0, 0, 0, 1, 0, 1], "Top church jobs go to the ruler's friends.", { Cl: -1, Co: -1 }, "church"],
  ["N9.4", "National Freedom of Religion", "Freedom of worship across the country.", [0, 2, 1, -2, 0, 0], "Arguments between religious groups.", { Co: -1, Cl: -1 }, "secular"],
  ["N9.5", "Closure of the Monasteries", "The monasteries' huge lands are taken over by the state.", [-1, 1, 0, -3, 1, 2], "Charity collapses and believers march in protest.", { Co: -2 }, "secular"],
  ["N9.6", "Separation of Church & State", "Religion becomes a private matter.", [0, 2, 1, -3, 0, -1], "Church leaders are furious, and nobody feeds the poor.", { Co: -1, Cl: -1 }, "secular"],
];

export const LAWS: Law[] = [];
export const LAW_BY_ID: Record<string, Law> = {};
{
  const counters: Record<string, number> = {};
  for (const [id, name, desc, w, down, d, tags] of raw) {
    const tier = id[0] as "R" | "N";
    const cat = Number(id[1]);
    const key = tier + cat;
    const pos = (counters[key] = (counters[key] ?? 0) + 1);
    const dd = GROUP_KEYS.map((k) => d[k] ?? 0) as W;
    const law: Law = { id, tier, cat, pos, name, desc, w, down, d: dd, tags: tags ? tags.split(" ") : [] };
    LAWS.push(law);
    LAW_BY_ID[id] = law;
  }
}

export function lawsOf(tier: "R" | "N", cat?: number): Law[] {
  return LAWS.filter((l) => l.tier === tier && (cat === undefined || l.cat === cat));
}

/** What a browser is allowed to know about the catalogue. */
export function publicCatalogue(): PublicLaw[] {
  return LAWS.map(({ id, tier, cat, pos, name, desc }) => ({ id, tier, cat, pos, name, desc }));
}

// ---- hidden friction between a regional law and a later nationwide one (1 mild, 2 direct)
const frictionRaw: [string, string, number][] = [
  ["R1.4", "N1.5", 2], ["R1.6", "N1.3", 2], ["R1.1", "N1.6", 2], ["R1.1", "N6.5", 2], ["R1.7", "N6.2", 2], ["R1.7", "N1.1", 2],
  ["R2.1", "N2.6", 2], ["R2.7", "N2.1", 1], ["R2.7", "N2.2", 1], ["R2.6", "N7.2", 1],
  ["R3.7", "N3.2", 2], ["R3.7", "N3.1", 2], ["R3.1", "N3.5", 2], ["R3.5", "N3.4", 1],
  ["R4.1", "N4.5", 2], ["R4.1", "N4.4", 2], ["R4.2", "N4.4", 2], ["R4.3", "N4.5", 2], ["R4.7", "N4.2", 2], ["R4.7", "N4.3", 2],
  ["R5.1", "N5.6", 2], ["R5.1", "N5.5", 2], ["R5.3", "N5.6", 2], ["R5.3", "N5.5", 2], ["R5.7", "N5.1", 2], ["R5.4", "N9.5", 1],
  ["R6.2", "N6.6", 2], ["R6.7", "N6.2", 2], ["R6.7", "N6.1", 2], ["R6.1", "N6.6", 2], ["R6.1", "N1.6", 2],
  ["R7.6", "N7.1", 2], ["R7.7", "N7.1", 2], ["R7.1", "N7.5", 2], ["R7.5", "N7.6", 1],
  ["R8.7", "N8.1", 2], ["R8.6", "N8.1", 2], ["R8.2", "N8.3", 2], ["R8.1", "N8.5", 1],
  ["R9.1", "N9.4", 2], ["R9.1", "N9.6", 2], ["R9.2", "N9.6", 2], ["R9.2", "N9.5", 2], ["R9.5", "N9.1", 1],
];
const FRICTION: Record<string, number> = {};
for (const [a, b, s] of frictionRaw) FRICTION[a + "|" + b] = s;

/** How far along its category's spectrum a law sits, 0..1. */
export function spectrum(law: Law): number {
  const n = lawsOf(law.tier, law.cat).length;
  return (law.pos - 1) / (n - 1);
}

/**
 * Friction between one regional law and one nationwide law: the explicit pairs above,
 * or a mild clash when the two sit at opposite ends of the same category.
 */
export function frictionBetween(regional: Law, national: Law): number {
  const explicit = FRICTION[regional.id + "|" + national.id];
  if (explicit) return explicit;
  if (regional.cat === national.cat && Math.abs(spectrum(regional) - spectrum(national)) >= 0.75) return 1;
  return 0;
}

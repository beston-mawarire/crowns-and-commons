// The legislation catalogue.
//
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
  // ---- 1 Economy & ownership: held in common -> private hands
  ["R1.1", "Common Workshops", "Workshops and mills are held in common, and all who work them share what they make.", [2, -3, -1, 0, 0, -3], "Free-riding sets in and shortages follow.", { Co: -1, Ar: -1 }],
  ["R1.2", "Town Mills & Ovens", "The town runs the mills and ovens at a fixed, fair fee.", [1, -1, 0, 0, 0, -2], "Queues grow, the mills decay and the fees creep up.", { Co: -1 }, "spend"],
  ["R1.3", "Assize of Bread", "The price of a loaf is pegged to the price of grain, so no baker can gouge.", [2, -1, -1, 1, 0, 0], "Bakers sell short weight, and shelves empty in lean months.", { Co: -1, Ar: -1 }, "grain"],
  ["R1.4", "Guild Charter", "Chartered guilds guarantee the quality of every craft.", [-1, -1, 3, 1, 0, 0], "The guilds shut out newcomers and prices rise.", { Co: -1, Me: -1 }],
  ["R1.5", "Chartered Company", "One company holds sole rights to a rich trade route and pays well for it.", [-1, 2, -1, 0, 0, 1], "Monopoly prices, and a company that buys the council.", { Co: -1, Ar: -1 }, "trade"],
  ["R1.6", "Open Shops", "Anyone may open a workshop and sell their wares.", [1, 2, -3, 0, 0, 0], "Masters' incomes collapse and shoddy goods flood the stalls.", { Ar: -1, Co: -1 }],
  ["R1.7", "Sell the Commons", "Sell the common lands for a handsome windfall.", [-2, 3, 0, -1, 0, 2], "The windfall is soon spent; the grazing and the rents are gone for good.", { Co: -2 }],

  ["N1.1", "Realm Holds Mines & Forests", "Mines and forests belong to the realm, and their profits pay for its needs.", [2, -3, -1, 0, 1, -3], "Crown works run slack and fill with cronies.", { Co: -1, Mi: -1 }],
  ["N1.2", "Crown Monopolies", "The crown alone sells salt and iron, at a steady price.", [-2, -2, -1, 0, 1, 1], "Smuggling thrives and salt riots break out.", { Co: -1, Mi: -1 }],
  ["N1.3", "Realm Statute of Crafts", "One code of trades for the whole realm, the same in every town.", [-1, -1, 2, 1, 0, 1], "Trades grow rigid and skilled hands run short.", { Me: -1, Ar: -1 }],
  ["N1.4", "One Coin, One Measure", "A single coinage and a single set of weights and measures.", [1, 2, 1, 0, 0, -1], "Lords lose their mints and tolls, and do not forget it.", { No: -2 }, "trade"],
  ["N1.5", "Charter of Free Enterprise", "Any subject may practise any trade, anywhere in the realm.", [0, 3, -2, 0, 0, 1], "The guilds collapse and fortunes pull apart.", { Ar: -1, Co: -1 }, "trade"],
  ["N1.6", "Great Sale of Crown Estates", "Sell the crown's estates and clear the realm's debts at a stroke.", [-2, 2, 0, -1, -1, 3], "Crown income falls, and taxes rise to fill the hole.", { Co: -1, Mi: -1 }],

  // ---- 2 Taxation: the rich pay -> everyone pays alike
  ["R2.1", "Hoard Levy", "A levy on the greatest estates, shared out among the poor.", [3, -2, 0, 0, 0, -3], "Fortunes are hidden or carried abroad.", { Me: -1, Co: -1 }],
  ["R2.2", "Graduated Hearth Tax", "The more hearths in a house, the more it pays.", [2, -1, 0, 0, 0, -2], "Chimneys are bricked up to dodge the count.", { Co: -1 }],
  ["R2.3", "Luxury Duties", "Tax silk and wine, never bread.", [1, -2, -1, 1, 0, -2], "Smugglers prosper; goldsmiths and silk-weavers lose work.", { Ar: -1 }],
  ["R2.4", "Tenth and Fifteenth", "A simple, flat levy on movable goods.", [-1, 0, 0, 0, 0, 1], "The assessment fossilises and new wealth goes untaxed.", { Co: -1 }],
  ["R2.5", "Ale & Salt Excise", "A small tax on everyday goods that nobody notices.", [-2, -1, -1, 0, 1, 2], "The poor pay most, and excise men are chased through the streets.", { Co: -1, Ar: -1 }],
  ["R2.6", "Tax Farm", "Bankers pay the year's taxes up front and collect them back themselves.", [-2, 2, -1, -1, 0, 1], "Collectors squeeze double and keep the difference.", { Co: -1, Ar: -1 }],
  ["R2.7", "Head Tax", "The same coin from every grown subject. Simple and equal.", [-3, 1, -1, 0, 0, 2], "Villages hide their sons, and talk of rising spreads.", { Co: -2, Mi: -1 }],

  ["N2.1", "Realm Wealth Levy & Dole", "Great fortunes fund a dole for every poor household in the realm.", [3, -2, 1, 0, 0, -3], "Wealth takes flight and assessors are bribed.", { Me: -1, Co: -1 }],
  ["N2.2", "Graduated Income Assessment", "Each pays according to what they earn.", [2, -1, 1, 0, 0, -2], "Clerks pry into every ledger in the land.", { Me: -1, Ar: -1 }],
  ["N2.3", "End Tax Privileges", "No more exemptions for lords or for the church.", [2, 1, 1, -3, 0, -3], "Pulpits and great halls unite against the measure.", { Cl: -1, No: -1 }, "secular"],
  ["N2.4", "Single Land Tax", "One clear tax, on land alone.", [1, 1, 1, -1, 0, -2], "Landlords pass it straight on in higher rents.", { Co: -2 }],
  ["N2.5", "Customs & Excise Realm", "Taxes are taken only at ports and markets.", [-2, -1, -1, 0, 1, 2], "Bread and ale grow dear, and smuggling booms.", { Co: -1, Me: -1 }],
  ["N2.6", "Abolish Direct Taxes", "No collector will ever knock at your door again.", [-1, 2, 1, -1, -2, 3], "Soldiers and almshouses go unpaid.", { Mi: -2, Co: -1 }],

  // ---- 3 Labour: workers protected -> masters in control
  ["R3.1", "Worker Commune", "Journeymen run their shops together and share the takings.", [3, -2, 1, 0, 0, -2], "Shops starve for capital and argue over every decision.", { Ar: -1, Co: -1 }],
  ["R3.2", "Relief Works", "Idle hands are paid to build walls, roads and bridges.", [2, -1, 0, 1, 1, -1], "Costly, and private hiring dries up.", { Me: -1, Ar: -1 }, "spend"],
  ["R3.3", "Wage Floor by Justices", "The justices set a fair minimum wage each year.", [2, -1, -1, 1, 0, -1], "Masters take on fewer hands.", { Co: -1, Ar: -1 }],
  ["R3.4", "Feast-Day Rest", "Rest on every holy day, and no labour after dusk.", [2, -1, 0, 2, 0, -1], "Less gets made, and orders run late.", { Me: -1, Ar: -1 }, "church"],
  ["R3.5", "Seven-Year Apprenticeship", "Every craftsman properly trained before he may trade.", [-1, -1, 2, 0, 0, 1], "Hands run short, and the young wait years for a living.", { Co: -1, Me: -1 }],
  ["R3.6", "Free Hire", "Master and worker bargain wages freely between themselves.", [-1, 3, -2, 0, 0, 1], "Wages swing wildly with every season.", { Co: -2 }],
  ["R3.7", "Wage Ceiling", "Wages are held at the old, customary levels.", [-3, 1, -1, 0, 0, 3], "Labourers slip away to better-paying lords, and anger simmers.", { Co: -1, No: -1 }],

  ["N3.1", "Right to Work", "Realm workshops guarantee a job to anyone who wants one.", [3, -2, 0, 0, 0, -2], "Costs balloon, and closing the workshops would mean riots.", { Me: -1, Co: -1 }, "spend"],
  ["N3.2", "Realm Wage Floor", "One minimum wage, the same from coast to coast.", [2, -1, 0, 1, 0, -1], "Poor country masters cannot pay it.", { Co: -1, No: -1 }],
  ["N3.3", "End Serfdom", "Every peasant in the realm is declared free.", [3, 1, 1, 0, 0, -3], "The freed owe redemption debts for a generation.", { Co: -2 }],
  ["N3.4", "Free Movement of Labour", "Any subject may seek work in any town.", [1, 2, -1, 0, 0, -1], "Villages empty and towns overflow.", { No: -1, Ar: -1 }],
  ["N3.5", "Combination Act", "No strikes and no workers' leagues: steady work for steady pay.", [-2, 2, -2, 0, 1, 2], "Journeymen meet in secret and the unrest goes underground.", { Ar: -1, Mi: -1 }],
  ["N3.6", "Realm Statute of Labourers", "Wages capped at customary rates throughout the realm.", [-3, 1, -1, 0, 0, 3], "Evasion everywhere, and revolt in the air.", { Co: -1, Mi: -1 }],

  // ---- 4 Trade: controlled -> open
  ["R4.1", "Price Maximum", "A top price for bread, salt and firewood.", [2, -3, -1, 0, 1, -1], "Goods vanish from the stalls and reappear in back alleys.", { Co: -2 }, "grain"],
  ["R4.2", "Grain Export Ban", "Our grain stays home to feed our own.", [2, -2, 0, 1, 0, -2], "Farmers plant less and the neighbours retaliate.", { Co: -1, Me: -1 }, "grain"],
  ["R4.3", "Cloth Tariff", "A duty on foreign cloth to protect our weavers.", [-1, -1, 3, 0, 0, 1], "Cloth grows dear and foreign ports strike back.", { Co: -1, Me: -1 }],
  ["R4.4", "Staple Market", "All wool is sold through one well-ordered market.", [-1, 1, 0, 0, 0, 1], "Carriage costs rise and wool is smuggled round the staple.", { Me: -1 }, "trade"],
  ["R4.5", "Market & Fair Charter", "A weekly market and a great fair every year.", [1, 2, 1, 1, 0, 1], "Tolls creep in and rival towns take offence.", { Me: -1 }, "trade"],
  ["R4.6", "Merchant Courts", "Swift courts settle trade disputes before the tide turns.", [-1, 3, 1, 0, 0, 0], "Debtors' goods are seized within the day.", { Co: -1, Ar: -1 }, "trade"],
  ["R4.7", "Free Port", "No tolls and no duties: every ship is welcome.", [1, 3, -2, 0, -1, -1], "Toll revenue vanishes and imports undercut local makers.", { Ar: -1, Mi: -1 }, "trade"],

  ["N4.1", "Realm Granary Board", "The realm buys grain in years of plenty and sells it in years of dearth.", [3, -2, 0, 1, 1, -1], "Costly, and the granary clerks grow fat.", { Me: -1, Co: -1 }, "spend grain"],
  ["N4.2", "Corn Law", "A duty on foreign grain keeps our farms prosperous.", [-3, -2, -1, 0, 0, 3], "Bread grows dear and the towns seethe.", { Co: -1, Ar: -1 }],
  ["N4.3", "Mercantile System", "Tariffs on imports and bounties on exports: sell much, buy little.", [-1, 1, 2, 0, 1, 1], "Retaliation abroad and smugglers at home.", { Me: -2 }, "trade"],
  ["N4.4", "Single Realm Market", "No tolls between the regions of the realm.", [1, 3, 0, 0, 0, -2], "Toll-owning lords lose a fortune.", { No: -1 }, "trade"],
  ["N4.5", "Free Trade Treaty", "Open our ports to the goods of every nation.", [2, 3, -2, 0, 0, -3], "Estates and workshops alike are undercut.", { Ar: -1, No: -1 }, "trade"],

  // ---- 5 Welfare: provided for all -> private charity
  ["R5.1", "Common Table", "A free meal every day for anyone who comes.", [3, -2, 0, 1, 0, -2], "Ruinously costly, and the hungry of other shires arrive.", { Me: -1, Co: -1 }, "spend grain"],
  ["R5.2", "Town Physician & Pest House", "A paid physician, and free care for the sick.", [2, -1, 1, 0, 1, -1], "Costly, and quarantines close the markets.", { Me: -1 }, "spend health"],
  ["R5.3", "Poor Rate", "Each parish relieves its own poor from a local rate.", [2, -1, 0, 1, 0, -1], "Ratepayers groan under the burden.", { Ar: -1, Me: -1 }, "spend grain"],
  ["R5.4", "Church Almonry", "The church hands out alms at the abbey gate.", [1, 0, 0, 2, 0, 0], "Alms reach some parishes and never reach others.", { Co: -1 }, "church"],
  ["R5.5", "Guild Mutual Aid", "The guilds look after their own sick and widowed.", [-1, 1, 2, 0, 0, 0], "Those outside the guilds get nothing.", { Co: -1 }],
  ["R5.6", "Workhouse Test", "Relief is given, but only inside the workhouse.", [-2, 1, 0, 0, 0, 1], "Misery behind the walls and riots at the gates.", { Co: -1, Cl: -1 }],
  ["R5.7", "Private Charity Only", "No poor tax at all: charity is a private virtue.", [-3, 2, 0, 0, 0, 2], "Vagrancy, theft and sickness spread.", { Co: -1, Ar: -1 }],

  ["N5.1", "Realm Relief Guarantee", "No subject of the realm shall starve.", [3, -2, 0, -1, 0, -2], "An enormous cost, and the church's charity is pushed aside.", { Me: -1, Cl: -1 }, "spend grain"],
  ["N5.2", "Plague Wardens", "Wardens of health in every port and town.", [2, -1, 0, 0, 1, 0], "Costly, and ports and fairs are shut at a rumour.", { Me: -1 }, "spend health"],
  ["N5.3", "A School in Every Parish", "Letters and numbers for every child.", [2, 1, 1, 1, 0, -1], "Costly, and the newly lettered begin to ask questions.", { No: -1, Cl: -1 }, "spend"],
  ["N5.4", "Realm Poor Law", "The same parish relief in every corner of the realm.", [2, -1, 0, 1, 0, -1], "Ratepayers revolt.", { Ar: -1, Me: -1 }, "spend grain"],
  ["N5.5", "Workhouse Act", "Relief everywhere, but only through the workhouse.", [-2, 1, 0, 0, 0, 1], "Misery and riots.", { Co: -1, Cl: -1 }],
  ["N5.6", "Repeal All Relief", "An end to public alms, and to the taxes that pay for them.", [-3, 2, 0, 0, 0, 2], "Vagrancy and disorder on every road.", { Co: -1, Mi: -1 }],

  // ---- 6 Land: shared land -> great estates
  ["R6.1", "Land to the Tiller", "The lords' fields go to those who plough them.", [3, 0, 0, -1, 0, -3], "Harvests dip while new holders find their feet.", { Co: -1, Me: -1 }],
  ["R6.2", "Protected Commons", "Grazing and gathering rights guaranteed for ever.", [2, -1, 0, 1, 0, -2], "The commons are grazed bare.", { Co: -1 }],
  ["R6.3", "Rent Cap", "Rents are frozen where they stand.", [2, -1, 0, 0, 0, -2], "Landlords stop mending roofs and ditches.", { Co: -1 }],
  ["R6.4", "Three-Field Custom", "Keep the old rotation our grandfathers kept.", [1, 0, 0, 1, 0, 1], "Yields never improve.", { Me: -1, Co: -1 }],
  ["R6.5", "Grain Bounty", "Farmers are paid a bounty on every bushel sold.", [-1, 0, 0, 0, 0, 2], "Costly, and bread at home grows dearer.", { Co: -1, Ar: -1 }],
  ["R6.6", "Free Sale of Land", "Land may be bought and sold like any other good.", [-1, 3, 0, 0, 0, -1], "Speculators buy up whole villages.", { Co: -1, No: -1 }],
  ["R6.7", "Enclosure", "Lords may fence the commons and farm them properly.", [-3, 1, 0, 0, 0, 3], "Cottagers are driven off, and hedges are torn down by night.", { Co: -1, Mi: -1 }],

  ["N6.1", "Great Redistribution", "Land reform across the whole realm.", [3, 0, 0, -2, 0, -3], "Harvests dip and lords resist with force.", { Co: -1, Mi: -1 }],
  ["N6.2", "Realm Charter of the Forest", "Common rights restored in every forest and waste.", [3, -1, 0, 0, 0, -2], "The land stays poor and unimproved.", { Me: -1, Co: -1 }],
  ["N6.3", "Buy-Out of Feudal Dues", "Peasants may buy themselves free of labour dues.", [2, 1, 0, -1, 0, -2], "Peasants sink into debt to pay for their freedom.", { Co: -2 }],
  ["N6.4", "Board of Agriculture", "Drainage, new crops and better ploughs.", [0, 1, 0, 0, 0, 2], "The gains go to the great estates.", { Co: -1 }],
  ["N6.5", "Free Land Market", "An end to entail: land goes to whoever will pay.", [0, 3, 0, 0, 0, -2], "Old estates are broken up and sold.", { No: -1, Co: -1 }],
  ["N6.6", "General Enclosure Act", "Enclose the open fields everywhere, by law.", [-3, 1, 0, 0, 0, 3], "Mass displacement fills the roads.", { Co: -1, Ar: -1 }],

  // ---- 7 Government: ruled from above -> self-rule
  ["R7.1", "Royal Governor", "A firm, appointed governor answers for the whole region.", [-1, -1, -1, 0, 2, -2], "Decisions are made by a stranger who knows nothing of the place.", { Co: -1, Me: -1 }, "spend order"],
  ["R7.2", "Salaried Clerks", "Offices go to examined clerks and are never bought.", [1, 1, 0, 0, 0, -2], "A growing wage bill and endless forms.", { Me: -1, Co: -1 }, "spend"],
  ["R7.3", "Great Survey", "Every hearth and field counted, so all are assessed fairly.", [0, -1, 0, -1, 1, -1], "Every hidden coin is found and taxed.", { Me: -1, Co: -1 }],
  ["R7.4", "Council of Estates", "Clergy, lords and burghers advise together.", [0, 1, 0, 1, 0, 1], "Nothing can ever be decided.", { Co: -1, Mi: -1 }],
  ["R7.5", "Lord Lieutenant", "A great magnate keeps order in the region.", [-2, -1, 0, 0, 1, 3], "Offices go to cousins and old feuds flare.", { Me: -1, Ar: -1 }, "order"],
  ["R7.6", "Borough Charter", "The burghers elect their own mayor.", [0, 3, 2, 0, 0, -2], "A handful of rich burghers run everything.", { Co: -1, Ar: -1 }],
  ["R7.7", "Folkmoot & Open Rolls", "Every householder has a vote in the folkmoot.", [3, 0, 1, -1, -1, -2], "Slow, noisy, and votes are bought with ale.", { Me: -1, Ar: -1 }, "liberty"],

  ["N7.1", "Absolute Crown", "One will rules the realm, swiftly and surely.", [-1, -1, -1, 1, 2, -1], "No one believes the law binds the ruler.", { Me: -1, No: -1 }, "order"],
  ["N7.2", "Exchequer & Bureaucracy", "Honest central accounts, kept by trained officers.", [0, 1, 0, 0, 1, -2], "Costly, and the nobility are sidelined.", { No: -1, Co: -1 }, "spend"],
  ["N7.3", "Parliament of Estates", "All the estates of the realm meet in one parliament.", [0, 1, 1, 1, 0, 1], "Sessions end in deadlock.", { Co: -1, Mi: -1 }],
  ["N7.4", "Great Charter", "No new levies without the consent of the great council.", [0, 1, 0, 1, -1, 3], "The barons veto everything and the crown runs short of coin.", { Co: -1, Mi: -1 }],
  ["N7.5", "Federal Compact", "Each region keeps its own laws and customs.", [1, 0, 0, 0, -2, 1], "No one pays for the common defence.", { Mi: -1, Me: -1 }],
  ["N7.6", "Common Franchise", "An assembly elected by every householder.", [3, 1, 1, -1, 0, -3], "Patronage machines buy whole boroughs.", { Me: -1, Ar: -1 }, "liberty"],

  // ---- 8 Justice & liberties: stern order -> wide liberties
  ["R8.1", "Curfew & Watch", "Gates shut at dusk and a watch walks the streets.", [-2, -1, -1, 0, 3, 1], "Night trade dies and the taverns empty.", { Me: -1, Ar: -1 }, "order"],
  ["R8.2", "Manor Courts", "Each lord judges his own tenants, close to home.", [-2, -1, 0, 0, 0, 3], "Justice depends on the lord's mood.", { Co: -1, Me: -1 }],
  ["R8.3", "Gallows Code", "Harsh sentences to put fear into thieves.", [-2, 1, 0, -1, 1, 2], "Juries refuse to convict rather than hang a neighbour.", { Me: -1, Cl: -1 }, "order"],
  ["R8.4", "King's Justices on Circuit", "Royal judges ride out to hear every case.", [1, 1, 1, 0, 0, -1], "Slow and costly: cases wait a year.", { Co: -1, Me: -1 }],
  ["R8.5", "Jury of Peers", "Every accused is judged by their neighbours.", [2, 1, 1, 0, 0, -1], "Juries acquit their friends.", { Me: -1, No: -1 }, "liberty"],
  ["R8.6", "Free Printing", "Anyone may print and post handbills.", [1, 1, 1, -2, -1, -1], "Libels and sedition on every wall.", { No: -1, Cl: -1 }, "liberty"],
  ["R8.7", "Habeas Corpus & Assembly", "No one is jailed without cause, and all may gather freely.", [2, 1, 2, 0, -2, -1], "Unrest becomes harder to put down.", { Mi: -1, No: -1 }, "liberty"],

  ["N8.1", "Martial Law & Informers", "Order across the realm, kept by soldiers and watchful eyes.", [-3, -2, -2, 0, 3, 1], "Neighbours inform on neighbours and trust collapses.", { Me: -1, Cl: -1 }, "order"],
  ["N8.2", "Realm Gallows Code", "The same harsh penalties in every court.", [-2, 1, 0, -1, 1, 2], "Juries will not convict.", { Me: -1, Cl: -1 }, "order"],
  ["N8.3", "King's Common Law", "One system of royal courts for all.", [1, 2, 1, -1, 0, -2], "Church and lords lose their courts, and their fees.", { Cl: -1, No: -1 }],
  ["N8.4", "Charter of Liberties", "Due process for every free subject.", [2, 1, 1, 0, -1, 1], "Justice slows to a crawl.", { Me: -1, Mi: -1 }, "liberty"],
  ["N8.5", "Bill of Rights", "Free speech, free petition and no cruel punishments.", [2, 2, 2, -1, -1, 0], "The great are mocked in print.", { No: -1, Cl: -1 }, "liberty"],
  ["N8.6", "Abolish Torture & Gallows", "No rack and no rope anywhere in the realm.", [1, 0, 1, 1, -2, -1], "Every theft becomes a panic.", { Me: -1, Co: -1 }, "liberty"],

  // ---- 9 Religion: one church -> secular realm
  ["R9.1", "One Faith Enforced", "One people, one worship, one peace.", [-1, -2, -2, 3, 0, 0], "Skilled dissenters pack up and leave.", { Ar: -1, Me: -1 }, "church"],
  ["R9.2", "Compulsory Tithe", "A tenth of every harvest keeps the church in good repair.", [-2, -1, -1, 3, 0, -1], "Farmers come to hate the tithe barn.", { Co: -1 }, "church"],
  ["R9.3", "Church Courts", "The clergy are judged by the clergy.", [-1, -1, 0, 3, 0, -1], "A scandal when a guilty priest walks free.", { Co: -1, No: -1 }, "church"],
  ["R9.4", "Church Schools & Alms", "The council pays for church schools and alms.", [1, 0, 1, 2, 0, 0], "Costly to keep up.", { Me: -1 }, "spend church"],
  ["R9.5", "Toleration Edict", "Other faiths may worship in peace.", [0, 2, 1, -2, 0, 0], "Quarrels between congregations.", { Co: -1, Cl: -1 }, "secular"],
  ["R9.6", "Tax Church Lands", "Church estates pay their fair share.", [1, 1, 0, -3, 1, 1], "Church charity dries up.", { Co: -2 }, "secular"],
  ["R9.7", "Secular Charter", "Church and council are kept apart.", [0, 2, 1, -3, 0, -1], "The church's schools and almshouses close.", { Co: -2 }, "secular"],

  ["N9.1", "Established Realm Church", "The church takes its seat in the great council.", [0, -1, -1, 3, 1, 1], "Dissent festers out of sight.", { Ar: -1, Me: -1 }, "church"],
  ["N9.2", "Realm Tithe", "The tithe is enforced in every parish.", [-2, -1, -1, 3, 0, -1], "The countryside resents every sheaf.", { Co: -1 }, "church"],
  ["N9.3", "Concordat", "Crown and church agree: the crown names the bishops.", [0, 0, 0, 1, 0, 1], "Bishoprics go to courtiers.", { Cl: -1, Co: -1 }, "church"],
  ["N9.4", "Edict of Toleration", "Freedom of worship across the realm.", [0, 2, 1, -2, 0, 0], "Sectarian quarrels.", { Co: -1, Cl: -1 }, "secular"],
  ["N9.5", "Dissolution of the Abbeys", "The abbeys' vast lands pass to the realm.", [-1, 1, 0, -3, 1, 2], "Charity collapses and pilgrims march in protest.", { Co: -2 }, "secular"],
  ["N9.6", "Separation of Church & Realm", "Faith becomes a private matter.", [0, 2, 1, -3, 0, -1], "The clergy are furious, and no one feeds the poor.", { Co: -1, Cl: -1 }, "secular"],
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

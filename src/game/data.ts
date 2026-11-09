// Static game data other than the legislation catalogue.
// Everything in here that is marked "hidden" must never be sent to a browser.

// Display names. The two-letter keys below are the internal codes used in the law tables:
// Co = commoners, Me = traders (merchants), Ar = craft workers (artisans),
// Cl = the church (clergy), Mi = soldiers (military), No = nobles.
export const GROUPS = ["Commoners", "Traders", "Craft workers", "Church", "Soldiers", "Nobles"] as const;
export const GROUP_KEYS = ["Co", "Me", "Ar", "Cl", "Mi", "No"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export const G = 6;

/** Six weights, one per group, in GROUP_KEYS order. */
export type W = [number, number, number, number, number, number];

export const CATEGORIES = [
  { id: 1, name: "Economy & Ownership", axis: ["Shared ownership", "Private ownership"] },
  { id: 2, name: "Taxes", axis: ["The rich pay more", "Everyone pays the same"] },
  { id: 3, name: "Jobs & Wages", axis: ["Workers protected", "Employers in control"] },
  { id: 4, name: "Trade & Business", axis: ["Controlled", "Open"] },
  { id: 5, name: "Help for the Poor & Public Services", axis: ["Help for everyone", "Private charity"] },
  { id: 6, name: "Land & Farming", axis: ["Shared land", "Big private estates"] },
  { id: 7, name: "Government", axis: ["Ruled from the top", "People decide"] },
  { id: 8, name: "Law, Justice & Freedoms", axis: ["Strict order", "More freedom"] },
  { id: 9, name: "Religion", axis: ["One official church", "Church and state separate"] },
] as const;

// ---------------------------------------------------------------- rules

export const RULES = {
  minPlayers: 2,
  maxPlayers: 5,
  startGold: 60,
  roundIncome: 40,
  actionsPerRound: 3,
  minLawsPerCategory: 2,
  maxLawsPerCategory: 3,
  /** Laws picked in one category in one round must sit within this many steps of each other. */
  maxSpread: 3,
  taxMin: 0,
  taxMax: 40,
  taxNeutral: 15,
  /** Share of the votes in your own region needed to reach the national election. */
  qualifyShare: 0.3,
  simChoices: [60, 120, 180, 300],
  planChoices: [0, 180, 300, 480, 720],
  defaultSimSec: 300,
  defaultPlanSec: 300,
  ticks: 10,
} as const;

// ---------------------------------------------------------------- campaign actions

export interface ActionDef {
  id: string;
  name: string;
  cost: number;
  desc: string;
}

/** Public part of the action catalogue. */
export const ACTIONS: ActionDef[] = [
  { id: "speech", name: "Public speech", cost: 10, desc: "Stand up in the market square and tell people what you will do." },
  { id: "visit", name: "Town visit", cost: 15, desc: "Travel out, shake hands, and listen to people's problems." },
  { id: "notices", name: "Campaign posters", cost: 15, desc: "Put your promises up on every door and wall." },
  { id: "lobby", name: "Private dinner with the powerful", cost: 20, desc: "A quiet word and a good meal with people who have influence." },
  { id: "relief", name: "Free food handout", cost: 25, desc: "Bread, blankets and firewood, handed out in your party's colours." },
  { id: "feast", name: "Public feast", cost: 30, desc: "Free food, free drink and music all night." },
];

/** HIDDEN: base strength of each action and how well it lands with each group. */
export const ACTION_HIDDEN: Record<string, { b: number; fit: W; sat?: number; backlash?: Partial<Record<GroupKey, number>> }> = {
  speech: { b: 0.2, fit: [1.0, 0.6, 1.0, 0.5, 0.6, 0.2] },
  visit: { b: 0.3, fit: [1.2, 0.8, 1.0, 0.8, 0.8, 0.4] },
  notices: { b: 0.3, fit: [0.4, 1.2, 1.0, 1.0, 0.6, 0.8] },
  lobby: { b: 0.4, fit: [-0.5, 1.0, 0.2, 0.8, 0.8, 1.5], backlash: { Co: -0.1 } },
  relief: { b: 0.5, fit: [1.5, 0.2, 0.8, 1.0, 0.8, -0.3], sat: 8 },
  feast: { b: 0.6, fit: [1.2, 0.8, 1.0, -0.2, 1.4, 0.6], sat: 6 },
};

// ---------------------------------------------------------------- vote model constants (HIDDEN)

export const MODEL = {
  /** How strongly a platform's appeal moves a group. */
  beta: 0.8,
  /** Softmax temperature: lower means groups vote more as a block. */
  mu: 0.5,
  /** Base pull of the Old Order (the difficulty knob), tuned by scripts/calibrate.ts. */
  q0: 0.23,
  /**
   * In the nationwide round the Old Order stays on the ballot but is a weakened force:
   * with this shift it takes roughly a quarter of the vote between typical platforms.
   */
  q0NationalShift: 1.0,
  /** Each failed regional round lowers the Old Order's pull by this much. */
  q0RestartStep: 0.08,
  /** Extra attachment of each group to the old ways. */
  qGroup: [-0.1, 0.0, 0.0, 0.4, 0.2, 0.5] as W,
  /** How much a contented group clings to the Old Order. */
  lambda: 0.4,
  /** Utility lost per 5 points of tax above neutral (negative = the group likes taxes). */
  taxUtil: [0.08, 0.07, 0.06, 0.02, -0.04, 0.08] as W,
  /** Satisfaction lost per 5 points of tax above neutral. */
  taxSat: [1.5, 1.0, 1.0, 0.5, -0.5, 1.5] as W,
  /** Platform sums are divided by this (two laws in each of nine categories). */
  lawNorm: 18,
  /** Round 2 blend of the regional record and the new national laws. */
  regionalShare: 0.4,
  /** Carrying your home region earns legitimacy only: no head start in the national round. */
  homeBonus: 0,
  noise: 0.15,
  tickNoise: 0.03,
  /** Hidden downsides fade in between these fractions of the count. */
  downsideFrom: 0.4,
  downsideTo: 0.8,
  downsideSat: 3,
  repeatSameTarget: 0.6,
  repeatSameAction: 0.8,
  frictionPerPoint: 0.1,
  frictionCap: 0.4,
  frictionStrong: 0.15,
  /** The tax rate a platform needs: a base, plus this much for every costly ("spend") law. */
  fundingBase: 8,
  fundingPerLaw: 2,
  /** With nothing in the treasury, costly laws lose this share of their appeal... */
  unfundedCut: 0.7,
  /** ...and every group marks the party down by this much (soldiers twice over). */
  unfundedPenalty: 0.35,
  eventChance: 0.4,
};

// ---------------------------------------------------------------- random events (HIDDEN effects)

export interface EventDef {
  id: string;
  name: string;
  /** Satisfaction change per group. */
  sat: W;
  /** Parties holding a law with this tag gain `bonus` with these groups; others lose `malus`. */
  tag: string;
  groups: GroupKey[];
  bonus: number;
  malus: number;
  regional: string[];
  national: string[];
}

export const EVENTS: EventDef[] = [
  {
    id: "harvest",
    name: "Poor harvest",
    sat: [-12, -4, -6, -3, -3, -4],
    tag: "grain",
    groups: ["Co", "Ar"],
    bonus: 0.3,
    malus: 0.15,
    regional: ["Crop disease in {region}: the harvest is much smaller than usual"],
    national: ["A wet summer has ruined crops across the country"],
  },
  {
    id: "trade",
    name: "Good trade season",
    sat: [3, 12, 6, 0, 0, 2],
    tag: "trade",
    groups: ["Me", "Ar"],
    bonus: 0.3,
    malus: 0.1,
    regional: ["Foreign ships crowd the port of {capital}; business is booming"],
    national: ["The best trading season in years, all across the country"],
  },
  {
    id: "festival",
    name: "Religious festival",
    sat: [5, 2, 3, 12, 2, 2],
    tag: "church",
    groups: ["Cl", "Co"],
    bonus: 0.3,
    malus: 0.1,
    regional: ["Crowds of pilgrims pour into {capital} for a big religious festival"],
    national: ["A national religious festival is declared; bells are ringing everywhere"],
  },
  {
    id: "unrest",
    name: "Trouble on the border",
    sat: [-5, -6, -4, -3, -10, -6],
    tag: "order",
    groups: ["Mi", "No"],
    bonus: 0.3,
    malus: 0.15,
    regional: ["Raiders burn two farms on the border of {region}"],
    national: ["Fighting on the border; the border regions are calling for soldiers"],
  },
  {
    id: "epidemic",
    name: "Disease outbreak",
    sat: [-12, -8, -8, -5, -6, -5],
    tag: "health",
    groups: ["Co", "Ar", "Me"],
    bonus: 0.35,
    malus: 0.1,
    regional: ["A serious illness reaches {capital}; people are staying indoors"],
    national: ["A disease is spreading along the trade roads; towns are closing their gates"],
  },
];

// ---------------------------------------------------------------- regions

export const REGION_NAMES = [
  { name: "Ashmark", capital: "Ashford", places: ["Cinderby", "Oxhill", "Greywater"] },
  { name: "Brackenfold", capital: "Brackley", places: ["Fernside", "Lowmoor", "Thistledown"] },
  { name: "Calderwick", capital: "Calder Bridge", places: ["Saltby", "Wrenmouth", "Harrow Cross"] },
  { name: "Dunmere", capital: "Dunmouth", places: ["Stonecot", "Millbrook", "Heronsgate"] },
  { name: "Eskvale", capital: "Eskby", places: ["Marlowe", "Nine Elms", "Coldharbour"] },
];

/** Regional characters; each region gets one at random, then a little noise. */
export const ARCHETYPES: { kind: string; blurb: string; mix: W }[] = [
  { kind: "farmland", blurb: "Farms and small villages", mix: [40, 10, 14, 12, 10, 14] },
  { kind: "port", blurb: "A busy harbour full of traders", mix: [28, 26, 18, 8, 10, 10] },
  { kind: "craft town", blurb: "Workshops and craft guilds", mix: [28, 16, 28, 9, 9, 10] },
  { kind: "cathedral city", blurb: "A great cathedral and many churches", mix: [30, 12, 14, 24, 8, 12] },
  { kind: "border region", blurb: "Castles and army camps", mix: [30, 10, 14, 10, 24, 12] },
  { kind: "noble estates", blurb: "Big country houses owned by old families", mix: [32, 10, 12, 12, 12, 22] },
];

export const COLORS = [
  { id: "crimson", hex: "#c0392b" },
  { id: "blue", hex: "#2456a6" },
  { id: "green", hex: "#2e7d4f" },
  { id: "gold", hex: "#c9950c" },
  { id: "purple", hex: "#6b3fa0" },
  { id: "teal", hex: "#148a8a" },
  { id: "orange", hex: "#d2691e" },
  { id: "rose", hex: "#c2477f" },
];

export const BOT_NAMES = [
  "The Honest Ploughmen",
  "League of the Golden Fleece",
  "Friends of the Old Mill",
  "The Lantern Party",
  "Brotherhood of the Bell",
  "The White Hart Faction",
  "Company of the Open Road",
  "The Hearth and Harrow",
];

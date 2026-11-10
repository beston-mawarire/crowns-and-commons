# Trade and Treachery

The second game mode, chosen by the host in the lobby. It is inspired by Christian Aid's
Trading Game: a simple picture of how trade can widen or narrow the gap between rich and poor
countries. All wording is our own.

## The idea

Every player is one country. Countries turn raw materials into goods and sell the goods to
the market. They start unequal, and nobody is told so. Everything else is left to the
players: what to trade, at what price, and whether to keep their word. Three to five people,
no bots, one live session of 10, 15 or 20 minutes.

## From the paper game to this one

| Paper game | Here |
| --- | --- |
| Sheets of paper | Raw materials: timber, ore, wool, grain, coal |
| Scissors | Workshops (one job at a time each) |
| Ruler, compass, set-square, protractor | Sawmill, forge, loom, mill, power plant |
| Five shapes worth £150 to £500 | Planks, cloth, tools, food, electricity, furniture, machinery (120 to 700 gold) |
| The banker, batches of five | The market, which is not a player; it buys goods in batches of five |
| Grade A, B and C envelopes | Three kinds of start, dealt at random |
| The leader's interventions | Timed events |
| The gummed paper | Amber |

## The three starts

Starts are dealt at random, and the details change every game, so no two countries (and no
two games) are alike.

| | Gold | Industry | Raw materials |
| --- | --- | --- | --- |
| Industrial country | 600 | 2 workshops and three of the five other industries | 1 or 2 each of three raw materials |
| Raw-material country | 200 | no workshop; half the time one industry it cannot yet use | 12 to 16 each of three raw materials, 2 of a fourth, 2 amber |
| Poor country | 200 | no workshop; often one industry it cannot yet use | 4 to 6 each of two raw materials, 2 of a third |

Three players get one of each; four get a second raw-material country; five also get a second
poor country. Nobody starts able to make everything, so the industrial country needs
buildings as well as materials from the others. Every country starts with 10 people.

## What can be made

Every product needs a workshop as well as the buildings listed.

| Product | Made from | Buildings | Price |
| --- | --- | --- | --- |
| Food | grain | mill | 120 |
| Electricity | coal | power plant | 130 |
| Planks | timber | sawmill | 150 |
| Cloth | wool | loom | 200 |
| Tools | ore | forge | 200 |
| Furniture | timber, wool | sawmill, loom | 300 |
| Machinery | ore, timber, electricity | forge, sawmill | 700 |

## What you can do

- **Make goods.** Each product needs a workshop plus its own building, uses raw materials,
  and takes 5 to 12 seconds an item.
- **Sell to the market** in batches of five, at the market's prices. The market will also buy
  raw materials, but only for 25 gold each.
- **Build:** a workshop costs 900 gold, a mill 500, the other industries 600, a border guard 300.
- **Buy and sell shares** in four companies (below).
- **Safe swap:** offer anything for anything, to one country or to whoever accepts first. It
  happens all at once or not at all.
- **Send:** give something away with no guarantee. Loans, aid and deals on trust are made
  this way, and nothing stops a promise being broken.
- **Talk:** to everyone, or privately to one country.

- **Lend a building** for 1 to 5 minutes.

## The host's two switches

- **Can you see what other countries hold?** On: everyone's holdings are visible, like tables
  in a room. Off: you see only your own, the news says only that a deal was made, and nobody
  can check what anyone claims. Everything is revealed when the market closes.
- **Lent buildings.** Either they come back by themselves when the loan ends, or they only
  come back if the borrower returns them.

With both switched off, a poor country can win by bluffing: it starts worth only a few
hundred, so talking its way into one workshop it never gives back (worth 900) more than
doubles it, while the industrial country would need to add thousands to keep pace.

## Payday

Every minute, each country:

1. receives 40 gold;
2. receives 3% of the value of the shares it holds;
3. feeds its people: one food for every ten people, taken from its stores, or imported at 25
   gold a meal;
4. pays 5% tax on its gold above 200, **unless** since the last payday it gave away 100
   gold's worth of anything, lent a building, or still has a building out on loan.

So hoarding gold costs money, and being generous (or looking generous) saves it. Each
country's worth is recorded at every payday, and players see their own worth, its change
since the start and a small chart of it at all times.

## The stock exchange

Four companies: Timber Co, Ironworks, Farm & Loom, Coal & Power. Shares start at 100 gold.
Prices drift a little every 30 seconds and jump when the news touches their industry: a
discovery or a boom lifts the matching company, a price crash sinks it. Shares count towards
worth at their current price, pay a dividend every payday, and can be swapped, sent and
promised like anything else.

## Borders

A border guard costs 300 gold. Two events are announced in advance, so there is time to
build one, or to gamble:

- **Migration.** Every country without a guard takes in 10 new people, who need feeding at
  every payday from then on.
- **Invasion.** Raiders (not a player) strike one country without a guard, taking a fifth of
  its gold and a quarter of its raw materials.

## What happens during the game

Roughly in this order, with a little variation in the timing:

1. **The secret.** The industrial country is told privately that a batch of goods set with
   one piece of amber sells for four times the price. The countries holding amber are not.
2. **A discovery.** A large deposit of a raw material is found in one of the poorer countries.
3. **A price crash.** The most valuable product halves in price.
4. **A strike.** One country's workshops stop for 45 seconds.
5. **Aid.** The poorest country without a workshop is offered a free workshop and mill. If it
   accepts, the lenders keep 30% of everything it sells to the market from then on.
6. **A tariff.** For a while the market pays 30% less for goods from countries that started
   without a workshop.
7. **A boom.** The cheapest product jumps in price.

The border warning and migration come early in the game; the raid warning and the invasion
come around the middle.

## Winning

A country's worth is its gold, its goods at their usual price, its raw materials at the
market's low price, its buildings at cost, and its shares at their current price. **The winner is the country whose worth grew
the most from where it started**, so every kind of start is worth playing. The richest
country is named too.

When the market closes, the results show what every country started with, how the price of
raw materials moved between the two halves, every deal in order, and four questions to talk
about.

## Not yet tested with people

The numbers (prices, production times, building costs, event sizes) are a first guess and
live at the top of `src/game/trade.ts`. In particular it is not yet known whether the poorer
starts can realistically out-grow the industrial one, whether payday (income, food, tax) is
too gentle or too harsh, or whether shares are too safe a place to park gold.

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
| Sheets of paper | Raw materials: timber, ore, wool |
| Scissors | Workshops (one job at a time each) |
| Ruler, compass, set-square, protractor | Sawmill, forge, loom |
| Five shapes worth £150 to £500 | Planks, cloth, tools, furniture, machinery (150 to 500 gold) |
| The banker, batches of five | The market, which is not a player; it buys goods in batches of five |
| Grade A, B and C envelopes | Three kinds of start, dealt at random |
| The leader's interventions | Timed events |
| The gummed paper | Amber |

## The three starts

| | Gold | Industry | Raw materials |
| --- | --- | --- | --- |
| Industrial country | 600 | 2 workshops, sawmill, forge, loom | 2 timber, 1 ore, 1 wool |
| Raw-material country | 200 | none | 16 timber, 14 ore, 14 wool, 2 amber |
| Poor country | 200 | none | 6 timber, 4 ore, 5 wool |

Three players get one of each; four get a second raw-material country; five also get a second
poor country. Everyone can see what everyone else holds, as they could across a room.

## What you can do

- **Make goods.** Each product needs a workshop plus its own building, uses raw materials,
  and takes 6 to 12 seconds an item.
- **Sell to the market** in batches of five, at the market's prices. The market will also buy
  raw materials, but only for 25 gold each.
- **Build industry:** a workshop costs 900 gold, the other buildings 600.
- **Safe swap:** offer anything for anything, to one country or to whoever accepts first. It
  happens all at once or not at all.
- **Send:** give something away with no guarantee. Loans, aid and deals on trust are made
  this way, and nothing stops a promise being broken.
- **Talk:** to everyone, or privately to one country.

## What happens during the game

Roughly in this order, with a little variation in the timing:

1. **The secret.** The industrial country is told privately that a batch of goods set with
   one piece of amber sells for four times the price. The countries holding amber are not.
2. **A discovery.** A large deposit of a raw material is found in one of the poorer countries.
3. **A price crash.** The most valuable product halves in price.
4. **A strike.** One country's workshops stop for 45 seconds.
5. **Aid.** The poorest country without industry is offered a free workshop and sawmill. If it
   accepts, the lenders keep 30% of everything it sells to the market from then on.
6. **A tariff.** For a while the market pays 30% less for goods from countries that started
   without industry.
7. **A boom.** The cheapest product jumps in price.

## Winning

A country's worth is its gold, its goods at their usual price, its raw materials at the
market's low price, and its buildings at cost. **The winner is the country whose worth grew
the most from where it started**, so every kind of start is worth playing. The richest
country is named too.

When the market closes, the results show what every country started with, how the price of
raw materials moved between the two halves, every deal in order, and four questions to talk
about.

## Not yet tested with people

The numbers (prices, production times, building costs, event sizes) are a first guess and
live at the top of `src/game/trade.ts`. In particular it is not yet known whether the poorer
starts can realistically out-grow the industrial one.

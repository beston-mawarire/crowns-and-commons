# Silent Fleet

A cross between Battleship and Tank Turn Tactics, played live by two to eight people.

## The idea

Every player chooses a country and commands one ship, three squares long, somewhere on a big
square map. **You can see your own ship and nothing else.** Action points arrive on a clock
and are spent on sailing, turning, radar and gunfire. The last ship afloat wins.

## The map

| Players | Map |
| --- | --- |
| 2 or 3 | 18 by 18 |
| 4 or 5 | 22 by 22 |
| 6 to 8 | 26 by 26 |

That is the automatic size. Before the game the host can instead fix the map at 18, 22, 26
or 30 squares a side.

Ships start at random, at least three squares from any edge and well apart from each other.
A ship lies either upright or sideways and has a bow, shown by an arrow.

## Action points

Everyone starts with 2. Every 30 seconds (a "turn") every ship afloat gets 2 more, up to 10.
They can be spent at any moment, in any order.

| Action | Cost | What it does |
| --- | --- | --- |
| Sail forwards or backwards | 1 | Moves one square along the ship's length. |
| Turn left or right | 1 | Swings the ship a quarter turn about its middle square, so upright becomes sideways. |
| Radar ping | 2 | Shows the squares of other ships that lie inside your radar range. |
| Fire | 3 | Fires at any square inside your gun range. |
| Increase range | 3 | Adds one square to both your gun range and your radar range. |
| Send points | the points sent | Gives action points to any other ship. |

- **Range** is counted from the nearest part of your ship. Guns and radar both start at just
  2 squares. Each increase adds one to both, up to 6 for guns and 5 for radar, so reaching
  full range takes four increases (12 points). On the map, guns are a faint red wash and radar
  is a blue line.
- **Radar** shows only the squares of a ship that are in range, so a ship on the edge of your
  radar appears as one or two squares and you must guess where the rest lies. It shows them as
  they are at that moment; the picture does not follow it, and is wiped
  after 6 turns. Every ship the radar touches is told so, and from roughly which direction
  (allies are not warned).
- **Fire** is blind: pick any square in range. You are told whether you hit. A ship that is
  hit is told roughly which direction the shot came from. If you miss, any ship within 2
  squares of the splash sees it land. **Three hits sink a ship**, wherever they land on it.
- Sinking a ship earns 3 action points.
- You cannot sail off the map. Sailing or turning into another ship fails, costs the points,
  and tells both captains that someone is right beside them.

## Alliances

Any captain can offer another an alliance for 2, 4, 6 or 10 turns. If it is accepted:

each sees the other's ship, live. That is all an alliance does: **allies can still fire on
each other**, so it is only as good as the trust behind it.

It ends when the turns run out, or the moment either captain breaks it; the other is told at
once. Alliances are secret from everybody else. Once only two ships are left, all alliances
end and no more can be made.

## The storm

The host can switch the storm off in the lobby; it is on unless they do. With it off, the
game simply lasts until one ship is left.

So that no game lasts for ever, a storm arrives on turn 12 (six minutes in), announced two
turns ahead. The outermost row of squares all round the map becomes deadly, and every two
turns another row is added, until only a 6 by 6 patch of calm water is left. A ship with any
part in the storm takes one damage each turn.

## Sunk captains

A sunk captain sees the whole map and every ship for the rest of the battle, but can no
longer send messages. When the battle ends everyone sees the final map, and a table of
shots, hits, radar pings and who sank whom.

## Not yet tested with real players

Every number here is a first guess and lives in `NAVAL` at the top of `src/game/naval.ts`:
how fast points arrive, what things cost, how far radar and guns reach, and when the storm
starts.

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

Ships start at random, at least three squares from any edge and well apart from each other.
A ship lies either upright or sideways and has a bow, shown by an arrow.

## Action points

Everyone starts with 3. Every 30 seconds (a "turn") every ship afloat gets 2 more, up to 10.
They can be spent at any moment, in any order.

| Action | Cost | What it does |
| --- | --- | --- |
| Sail forwards or backwards | 1 | Moves one square along the ship's length. |
| Turn left or right | 1 | Swings the ship a quarter turn about its middle square, so upright becomes sideways. |
| Radar ping | 2 | Shows every ship with any part within 5 squares of your middle square. |
| Fire | 2 | Fires at any square within 6 squares of your middle square. |
| Send points | the points sent | Gives action points to any other ship. |

- **Radar** shows where a ship is at that moment; the picture does not follow it, and is wiped
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

- each sees the other's ship, live;
- neither can fire on the other.

It ends when the turns run out, or the moment either captain breaks it; the other is told at
once. Alliances are secret from everybody else. Once only two ships are left, all alliances
end and no more can be made.

## The storm

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

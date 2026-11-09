# Crowns & Commons: master design

One place for how the game works now. All wording that players see (laws, news, buttons) is
in plain modern English. Section 13 lists what changed from the original design conversation
and why, so any of it can be put back.

## 1. The game in a paragraph

A lightweight, text-first, multiplayer strategy game in the browser. It is a war game without
the war: players are political parties on a small medieval continent. Each chooses laws, sets
a tax rate and campaigns; a simulated population of six social groups reacts; and elections
decide who goes on. Every law has a give and take, and the "take" is hidden: players learn it
from the news and from the results. A match is one regional election, then one national
election for seats in a council, and ends when the country has a government.

## 2. Players, map and look

- 2 to 5 players. Bots can fill seats (for solo testing and balancing).
- The continent is split into exactly as many regions as there are players. Each player is
  given a home region at random.
- Each player chooses a party name and a colour. The page is black and white; party colours
  are the only colour.
- Screen: the map in the centre, the timer and the news along the top, the list of parties on
  the left, the decisions panel on the right. A scrollable list under the map keeps every
  headline from the current count.
- In round one each region is outlined in its party's colour but left unpainted. Regions are
  painted only as votes are counted, in proportion to vote share.
- Friends join with a shared room link. Nobody can join or watch once a match has started,
  except the players already in it.

## 3. Flow of a match

1. **Lobby.** The host chooses a full or a quick game, the planning time and the length of a
   count, then starts.
2. **The big issue.** Each match draws one public "big issue" (food shortage, fear of war,
   tax anger and so on). Laws in its two areas count double all match.
3. **Round 1, regional election.**
   - *Planning.* Everyone chooses laws for their own region, a regional tax rate and up to
     three campaign actions, then locks in.
   - *The count.* Starts when every party has locked in (or the planning clock runs out).
     About five minutes, with a timer, news and the map filling in. No numbers are shown.
   - *Half-time.* Halfway through, the count stops for up to 25 seconds and every party makes
     one move (section 8). Then the second half plays out with those moves in it.
   - *Result.* The map is fully painted. **View results** shows, for every party, the share
     of each group that voted for it.
4. **Qualification.** A party needs at least 30% of the votes cast in its home region.
   - Exactly one party qualifies: it wins the match outright.
   - No party qualifies: the regional round is held again.
   - Two or more qualify: they go on to round two. The rest are knocked out, but can still
     endorse (section 9).
5. **Round 2, national election.**
   - *Planning.* Qualifiers keep their regional laws and add national laws on top, set a
     national tax rate, and take three campaign actions anywhere, including attacks on rivals.
   - *The count*, with half-time, as before. Every qualifier is on the ballot in every region.
   - *Seats.* Votes become seats in the council (section 10).
6. **Government.** A party with more than half the seats wins. With three or more parties and
   no majority, there are coalition talks (section 11). With two parties, most seats wins.

## 4. The people

Six groups, shown in the game as commoners, traders, craft workers, church, soldiers, nobles.

- Every region has its own mix (a port has more traders, a border region more soldiers).
  Players can see the mix and a one-word mood for each group.
- Each group in each region has a satisfaction score from 0 to 100. It is regional, never
  shown as a number, and carries over from round one into round two.
- Each group has hidden likes and dislikes for every law and every campaign action.
- **Tastes shift a little every match.** Each group's preference in each area slides a short
  way along that area's spectrum, differently every game, so no platform can be memorised.
- Groups do not vote as blocks. Each group's votes are split, and many people stay at home.

## 5. Legislation

- Nine areas: economy and ownership; taxes; jobs and wages; trade and business; help for the
  poor and public services; land and farming; government; law, justice and freedoms; religion.
- 116 laws: seven regional options per area, and five or six national ones.
- Within an area the options run along a spectrum (for example from "shared ownership" to
  "private ownership"), so a platform can lean hard either way or stay in the middle.
- **Full game:** 2 or 3 laws in every area, each round. **Quick game:** 1 or 2.
- Everyone sees the same catalogue. Each law shows its name and what it promises. Its
  downside is hidden.
- **No contradictions within a round.** Laws chosen in one area must sit within three steps
  of each other on the spectrum; anything further away is greyed out.
- **Contradictions between rounds are allowed, and cost you.** A national law may clash with
  a party's own regional laws. There is no warning. The clash makes the party less credible
  with every group and shows up in the news.

## 6. Tax

- A slider from 0% to 40%, set for the home region in round one and for the whole country in
  round two.
- Lower taxes are popular with almost everyone (soldiers are the exception).
- Laws that cost money need funding: the more of them a platform has, the higher the rate it
  needs. Below that, those laws lose much of their appeal and every group marks the party down.

## 7. Campaigning and money

- 60 gold at the start. No borrowing. Unspent gold carries over.
- **Gold for round two follows the regional result:** 20 gold, plus 1 for every 2% of the
  vote the party won in its region (30% gives 35 gold, 50% gives 45, 60% gives 50). If the
  regional round is re-run, everyone gets a flat 40.
- Up to three actions a round. Each is aimed at one group (and, in round two, one region).
  Repeats work less well each time.

  | Action | Gold | Notes |
  | --- | --- | --- |
  | Public speech | 10 | |
  | Town visit | 15 | |
  | Campaign posters | 15 | |
  | Private dinner with the powerful | 20 | Annoys commoners a little |
  | Free food handout | 25 | Also lifts the group's mood |
  | Public feast | 30 | Also lifts the group's mood |
  | Attack on a rival | 20 | National round only (below) |

- How well an action lands depends on hidden weights.
- **Attacks.** Choose a rival, a group and a region. The attack takes votes off that rival
  with that group there. It bites hard if the rival really has a law that group dislikes and
  weakly if not, and about three times in ten it backfires on the attacker instead.

## 8. Half-time

Halfway through every count, each party still in the race gets one move, chosen from what the
news has shown so far:

- **Speak to one group** (in round two, in one region): a boost with them for the second half.
- **Scrap one of this round's laws:** its effect, its downside and any clash it caused stop
  for the second half, and it comes off the record. Rivals call it a U-turn, which costs a
  little with everyone.
- **Do nothing.**

The count restarts as soon as every player has chosen, or after 25 seconds. Every move makes
the news.

## 9. Knocked-out parties

A party that misses the bar watches round two and may **endorse** one party still in the race
before the national vote. That party gets a boost with every group in the endorser's old region.

## 10. Seats

- Each region has one council seat per 10,000 voters.
- A region's seats are shared between the parties by their votes there. Votes for the Old
  Order win no seats.
- The party that comes first in a region wins 2 bonus seats there.
- Results show the council as a row of coloured squares, plus votes and seats by region.

## 11. Coalition talks

With three or more parties in the national round and no party holding more than half the
seats, there are 45 seconds of talks. Every party privately picks one partner, or goes it
alone. Two parties that pick each other govern together and add their seats up. The biggest
group wins; in a winning pair the larger party is the winner and the other is its partner.
If nobody makes a deal, the party with the most seats wins.

## 12. How votes are worked out

For each region, each group, and each option on the ballot, the game computes a score:

- **A party's score** = how well its laws suit the group this match (hidden weights, the big
  issue, the year's shift in tastes, and downsides fading in during the second half), minus
  the tax effect, minus any funding shortfall, plus campaign actions, minus attacks that
  landed, minus clashes between its regional and national laws, plus endorsements and its
  half-time move, plus or minus a random event, plus a little luck.
- **The Old Order's score.** The Old Order means "keep things as they are". It is stronger
  with groups attached to the old ways (nobles, church, soldiers) and with groups that were
  content before the match. It stays on the ballot in round two as a much weaker force.

Scores become vote shares through a softmax, so a group leans rather than flips. Turnout in
each group rises with its satisfaction. In other words: laws and campaigning decide *whom* a
group prefers; satisfaction decides *how many of them bother to vote*.

In round two the platform score is 40% the regional laws and 60% the national ones.
Random events (poor harvest, good trade season, religious festival, trouble on the border,
disease outbreak) are rare and moderate, and reward parties whose laws prepared for them.

The numbers behind all this live in `src/game/data.ts` (`MODEL`, `RULES`) and `src/game/laws.ts`.

## 13. What changed from the original conversation, and why

| # | Original | Now | Why |
| --- | --- | --- | --- |
| 1 | 50% of your region to qualify | 30% | Asked for after the first live test, so that most matches reach round two. Round one is now mainly where you learn your region and earn your war chest; only a platform its region really dislikes is knocked out. |
| 2 | Identical income for everyone | Round-two gold follows the regional result | With the bar at 30% nearly everyone passes, so round one needed something to play for. Every percent now counts. To undo: set `donationPerShare` to 0 and `donationBase` to 40. |
| 3 | Most votes wins the national election | Most seats wins, with bonus seats for coming first in a region | Makes the map matter: close regions are worth fighting over. |
| 4 | Parties never affect each other | Attacks, endorsements, coalition talks | Gives players reasons to talk, bargain and hold grudges. |
| 5 | The count is watched from start to finish | One move at half-time | The news becomes something you act on. |
| 6 | The same hidden preferences every match | A public big issue and a hidden shift in tastes each match | Replayability: the best platform is different every game. |
| 7 | 2 or 3 laws per area, always | Quick game option with 1 or 2 | A first match in about ten minutes. |
| 8 | Old Order could out-poll parties in round two | Much weaker in round two and wins no seats | A match must end with a government. |
| 9 | Strong regional result gives no advantage | Still no bonus to votes; it now brings gold (row 2) | See row 2. |

Earlier build decisions that still stand: a planning clock with a clerk who fills gaps when
it runs out; host-adjustable count length and a skip button; taxes must fund costly laws; a
re-run of round one keeps your laws and weakens the Old Order; any player can press the
host's buttons if the host drops out.

## 14. Left for later

Reputation and voter loyalty, scandals and journalists, party debt, a governing period after
the election, further election cycles, regional make-up that drifts over several elections.

## 15. Technical outline

- Cloudflare Workers. One Durable Object per room holds the state, talks to browsers over
  hibernatable WebSockets, and uses one alarm as its clock. Static files are served directly.
- A count is computed when everyone locks in and released in ten slices. At half-time it is
  computed again with the parties' moves; the same seed makes the first half identical.
- Hidden numbers and other parties' plans are never sent to a browser.
- A player who refreshes or drops returns to the same seat (a token is kept in the browser).
- Rooms delete themselves after three hours without activity.
- No frameworks and no build step on the page; TypeScript on the server. Everything added
  since the first version is rules and text: no extra servers, storage or paid features.

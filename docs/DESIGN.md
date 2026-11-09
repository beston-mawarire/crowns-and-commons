# Crowns & Commons: master design (phase one)

One place for everything agreed so far. Section 12 lists the choices that were made while
building and still want a yes or no from playtesting.

## 1. The game in a paragraph

A lightweight, text-first, multiplayer strategy game in the browser. It is a war game without
the war: players are political parties on a small medieval continent. Each chooses laws, sets
a tax rate and campaigns; a simulated population of six social groups reacts; and elections
decide who goes on. Everything a law does has a give and take, and the "take" is hidden: players
learn it from the news and from the results. One match is self-contained and ends when the
realm has a winner.

## 2. Players, map and look

- 2 to 5 players. Bots can fill seats (for solo testing and balancing).
- The continent is split into exactly as many regions as there are players. Each player is
  given a home region at random.
- Each player chooses a party name and a colour. The page is black and white; party colours
  are the only colour.
- Screen: the map in the centre, the timer and the news ticker along the top, the list of
  parties on the left, the decisions panel on the right. The right panel greys out once a
  player has locked in.
- In round one each region is outlined in its party's colour but left unpainted. Regions are
  painted only as votes are counted, in proportion to vote share.
- Friends join with a shared room link. Nobody can join or watch once a match has started,
  except the players already in it.

## 3. Flow of a match

1. **Lobby.** The host sets the planning time and the length of a count, then starts.
2. **Round 1, regional election.**
   - *Planning.* Everyone chooses laws for their own region, a regional tax rate and up to
     three campaign actions, then locks in. Campaigning is limited to the home region.
   - *The count.* Starts when every party has locked in (or the planning clock runs out).
     Opens with "The polls are now open". Runs about five minutes with a timer, news flashes
     and the map filling in every thirty seconds. No numbers are shown.
   - *Result.* The map is fully painted. **View results** shows, for every party, the share
     of each group that voted for it.
3. **Qualification.** A party needs at least 50% of the votes cast in its home region.
   - Exactly one party qualifies: it wins the match outright.
   - No party qualifies: the regional round is held again.
   - Two or more qualify: they go on to round two. The rest are eliminated and watch.
4. **Round 2, nationwide election.**
   - *Planning.* Qualifiers keep their regional laws (they cannot be removed) and add
     nationwide laws on top, set a national tax rate, and take three campaign actions
     anywhere on the continent.
   - *The count.* As before, with every qualifier on the ballot in every region.
   - *Result.* The party with the most votes across the realm wins. Rankings, bar graphs,
     and each party's most and least popular laws (with their hidden costs revealed).

## 4. The people

Six groups: commoners, merchants, artisans, clergy, military, nobility.

- Every region has its own mix (a port has more merchants, a border march more soldiers).
  Players can see the mix and a one-word mood for each group.
- Each group in each region has a satisfaction score from 0 to 100. It is regional, it is
  never shown as a number, and it carries over from round one into round two.
- Each group has hidden likes and dislikes for every law and every campaign action.
- Groups do not vote as blocks. Each group's votes are split between the parties, and many
  people stay at home.

## 5. Legislation

- Nine categories: economy and ownership; taxation and redistribution; labour and
  employment; trade and commerce; welfare and public services; land and agriculture;
  government and administration; law, justice and liberties; religion and institutions.
- 116 laws: seven regional options per category, and five or six nationwide ones.
- Within a category the options run along a spectrum (for example from "held in common" to
  "private hands"), so a platform can lean hard either way or stay in the middle. Ideology is
  not chosen up front: it emerges from what a party passes.
- In each round a party picks **at least 2 and at most 3** laws in **every** category.
- Everyone sees the same catalogue. Each law shows its name and what it promises. Its cost is
  hidden.
- **No contradictions within a round.** Laws chosen in one category must sit within three
  steps of each other on the spectrum; anything further away is greyed out.
- **Contradictions between rounds are allowed, and cost you.** A nationwide law may clash
  with a party's own regional record. There is no warning. The clash ("friction") makes the
  party less credible with every group, most of all with the groups that cared about either
  law, and shows up in the news.
- Regional laws shape the home region in round one and become part of the party's identity
  everywhere in round two.

## 6. Tax

- A slider from 0% to 40%. It is set for the home region in round one and for the whole realm
  in round two.
- Lower taxes are popular with almost everyone (soldiers are the exception).
- Costly promises need funding: the more laws a platform has that cost money, the higher the
  rate it needs. Below that, those laws lose much of their appeal partway through the count
  and every group marks the party down.

## 7. Campaigning and money

- 60 gold at the start, plus 40 at the start of each later round. Unspent gold carries over.
  Income is identical for everyone and does not depend on laws.
- No borrowing. A party that cannot afford an action cannot take it.
- Up to three actions a round. Each action is aimed at one group chosen by the player (and,
  in round two, one region). The same action may be repeated, with diminishing returns.
- Prices are fixed and the same for everyone:

  | Action | Gold |
  | --- | --- |
  | Public speech | 10 |
  | Visit a settlement | 15 |
  | Campaign notices | 15 |
  | Lobby wealthy lords | 20 |
  | Distribute food and relief | 25 |
  | Public feast | 30 |

- How well an action lands depends on hidden weights: relief delights commoners and insults
  nobles; lobbying works on lords and annoys the commons; and so on.

## 8. How votes are worked out

For each region, each group, and each option on the ballot, the game computes a score:

- **A party's score** = how well its laws suit the group (the sum of hidden weights, with
  delayed downsides fading in during the second half of the count), minus the tax effect,
  minus any shortfall in funding, plus its campaign actions aimed at that group, minus
  friction, plus or minus a random event, plus a little luck.
- **The Old Order's score.** The Old Order is the council that already sits: a vote for
  "none of these". It is stronger with groups that are attached to the old ways (nobility,
  clergy, military) and with groups that were content before the match began. It stays on the
  ballot in round two as a much weaker force.

Scores become vote shares through a softmax, so a group leans rather than flips. Turnout in
each group rises with its satisfaction and with how much it prefers its favourite to the Old
Order. Votes are then weighted by each group's share of the region's population.

In other words: laws and campaigning decide *whom* a group prefers; satisfaction decides
*how many of them bother to vote*.

- In round one each party is alone on the ballot in its home region against the Old Order,
  and needs half of the votes cast.
- In round two the platform score is 40% the regional record and 60% the new nationwide laws.
- Carrying a home region earns legitimacy only. There is no bonus of any kind in round two.
- If nobody qualifies, the Old Order is a little weaker each time the round is re-run.

The numbers behind all this live in `src/game/data.ts` (`MODEL`) and `src/game/laws.ts`.

## 9. Random events

Rare (about two elections in five have one) and moderate. They can happen in either round;
in round one they strike a single region, in round two sometimes the whole realm. Poor
harvest, good trade season, religious festival, border unrest, epidemic. Context matters: a
party with grain laws is praised in a bad harvest, a party without is blamed.

## 10. The news ticker

- One shared ticker for everyone, in the style of Cookie Clicker's news line: a new headline
  every six seconds or so, with a short log under the map.
- Headlines are qualitative only. No vote counts until the count is over.
- Every headline is generated from the real hidden numbers: which group liked or hated which
  law, how a campaign action landed, a hidden downside starting to bite, an unfunded promise,
  a contradiction between a party's regional and nationwide laws, a party gaining or losing
  ground, or an event.
- A coloured dot shows which party a headline is about.

## 11. After each count

- The map shows each party's share of each region as painted area. Hatching is the Old Order.
- **View results** opens bar graphs for every party, not only your own: the share of each
  group that voted for it. Round two adds a table of every region.
- Every party's platform becomes public record once the votes are in.
- At the end of the match, each party's three most and least popular laws are listed, and the
  hidden costs are finally shown.

## 12. Decisions made while building (please confirm or change)

| # | Choice | Why |
| --- | --- | --- |
| 1 | Planning has a clock (default 5 minutes; the host can pick 3 to 12 minutes or no limit). When it runs out, a clerk fills any category that is short and locks everyone in. | The conversation asked for both a five-minute phase and "start when everyone is locked in". This does both. With 63 laws to read, five minutes is tight for a first match. |
| 2 | The host can shorten a count to 1, 2 or 3 minutes, and the count ends early if every player presses **Hasten the count**. | Five minutes is the default as designed; shorter counts make testing bearable. |
| 3 | When nobody qualifies, parties keep their previous laws as a starting point, receive 40 gold, satisfaction resets, and the Old Order is slightly weaker. | So a re-run is quick and cannot loop for ever. |
| 4 | In round two each campaign action chooses a region as well as a group. | "The whole continent becomes one shared space for campaigning." |
| 5 | The Old Order cannot win round two. The party with the most votes wins even if the Old Order outpolls it. | A match must end with a winner. |
| 6 | Taxes must cover costly promises (section 6). | Otherwise 0% tax is always the best choice and the slider is not a decision. |
| 7 | Players see their region's group mix and a mood word per group. | Something has to be visible to plan against; the weights stay hidden. |
| 8 | If the host disconnects, any player still present may press the host's buttons. | So a match cannot be stranded. |

## 13. Left for phase two

Reputation and voter loyalty (short-term popularity versus long-term trust), scandals and
journalists, party debt, a governing period after the election, further election cycles,
income that depends on economic law, regional make-up that drifts over several elections.

## 14. Technical outline

- Cloudflare Workers. One Durable Object per room holds the state, talks to browsers over
  hibernatable WebSockets, and uses one alarm as its clock. Static files are served directly.
- The whole count is computed when everyone locks in and released in ten slices. Hidden
  numbers and other parties' plans are never sent to a browser.
- A player who refreshes or drops returns to the same seat (a token is kept in the browser).
- Rooms delete themselves after three hours without activity.
- No frameworks and no build step on the page; TypeScript on the server.

# Crowns & Commons

A small multiplayer election game for the browser. Two to five parties share one medieval
continent, cut into one region each. Write the laws, court the people, win half of your own
region, then win the country. No combat, no game engine, no accounts: send friends a link.

The full rules, and every design decision behind them, are in [docs/DESIGN.md](docs/DESIGN.md).

## Play it locally

```
npm install
npm run dev          # http://127.0.0.1:8787
```

Open the page, press **Open a new room**, and either send the link to friends or press
**Add a bot party** to fill seats and play alone. For quick testing, set *Length of each count*
to one minute in the lobby; during a count, **Hasten the count** skips to the result.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the game locally with Wrangler (Worker, Durable Object and static files). |
| `npm test` | Unit tests for the catalogue, the rules, the election model and a whole match. |
| `npm run e2e` | Plays a full match over real WebSockets against a running server (start `npm run dev` first). |
| `npm run calibrate` | Monte Carlo report on difficulty. Add `-- --tune` to search for a new `q0`. |
| `npm run typecheck` | TypeScript check. |
| `npm run deploy` | Deploys to Cloudflare by hand (needs `wrangler login`). |

## Deploying

The game runs on Cloudflare Workers with one Durable Object per room, which fits the free plan.
`.github/workflows/deploy.yml` tests every push and deploys `main` once two repository secrets exist:

- `CLOUDFLARE_API_TOKEN`: an API token made from the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`: your account id

Until those are set the deploy step is skipped and only the tests run. The first deploy creates
the `GameRoom` Durable Object from the migration in `wrangler.jsonc`.

## How it is put together

```
public/            the page: plain HTML, CSS and JavaScript modules, no build step
  js/app.js        draws whatever the server says is visible
  js/map.js        the hex map and the "ink spreading" paint
src/worker.ts      routes /api/rooms and /ws/CODE; everything else is a static file
src/room.ts        the Durable Object: WebSockets, storage, one alarm as the room's clock
src/game/
  data.ts          rules, campaign actions, events, regions, and the hidden model constants
  laws.ts          the catalogue: 116 laws, their hidden weights, downsides and contradictions
  sim.ts           the election model (pure and seeded)
  headlines.ts     the news ticker
  rules.ts         what may be locked in, plus the clerk that fills gaps and plays bots
  game.ts          the match as a state machine: lobby, planning, count, results, final
```

Two things keep it cheap and honest:

- **The whole count is worked out the moment everyone locks in**, then released a slice at a
  time by a Durable Object alarm (ten slices per count). Between slices the room is asleep.
- **Hidden numbers never leave the server.** Browsers receive law names and promises only;
  weights, satisfaction and other parties' plans stay behind until the rules reveal them.

## Tuning the balance

All balance lives in data, not code:

- `src/game/laws.ts`: each law's weights for the six groups (`w`, from -3 to +3), its delayed
  downside (`d`) and its tags.
- `src/game/data.ts` `MODEL`: how strongly platforms move voters, the pull of the Old Order
  (`q0`), tax effects, campaign strengths, event odds.

After changing either, run `npm run calibrate`. With the qualifying bar at 30%
(`RULES.qualifyShare`), almost every sensible platform reaches the national round and only
a platform its region really dislikes is knocked out; in the national round the Old Order
takes about a quarter of the vote.

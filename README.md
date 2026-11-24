# Silent Fleet, and Trade and Treachery

Two small multiplayer games for the browser, for friends with a link. No accounts, no game
engine, no bots.

- **Silent Fleet**: two to eight captains on a big hidden map. You see only your own ship.
  Find the others with radar, fire blind, make alliances and break them. The last ship afloat
  wins. Rules: [docs/NAVAL.md](docs/NAVAL.md).
- **Trade and Treachery**: three to five countries and one live market, about unequal starts,
  shares and broken promises. Rules: [docs/TRADE.md](docs/TRADE.md).

Each room plays the game it was opened for, chosen with the tabs on the front page.

(The repository is still called `crowns-and-commons`, after the election game that Silent
Fleet replaced. That game is in the git history.)

## Play it locally

```
npm install
npm run dev          # http://127.0.0.1:8787
```

Open the page, pick a game, press **Open a new room**, and open the link in more browser
windows (private windows count as different players).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the games locally with Wrangler (Worker, Durable Object and static files). |
| `npm test` | Unit tests for the rules of both games. |
| `npm run typecheck` | TypeScript check. |
| `npm run deploy` | Deploys to Cloudflare by hand (needs `wrangler login`). |

## Deploying

The game runs on Cloudflare Workers with one Durable Object per room, which fits the free plan.
`.github/workflows/deploy.yml` tests every push and deploys `main` once two repository secrets exist:

- `CLOUDFLARE_API_TOKEN`: an API token made from the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`: your account id

Until those are set the deploy step is skipped and only the tests run. The first deploy creates
the `GameRoom` Durable Object from the migration in `wrangler.jsonc`.

Open pages keep themselves up to date. When a new version is deployed, every open page
notices (on reconnecting, when it comes back to the front, and every two minutes) and reloads
itself; games carry on, because the state lives in the room and each seat is remembered.
Pages also reconnect on their own after a phone sleeps or the network drops.

## How it is put together

```
public/            the page: plain HTML, CSS and JavaScript modules, no build step
  js/app.js        the front page, the connection and the lobby
  js/naval.js      the Silent Fleet screen
  js/trade.js      the Trade and Treachery screen
src/worker.ts      routes /api/rooms and /ws/CODE; everything else is a static file
src/room.ts        the Durable Object: WebSockets, storage, one alarm as the room's clock
src/game/
  game.ts          the room: players, lobby, and which game is running
  naval.ts         the rules of Silent Fleet
  trade.ts         the rules of Trade and Treachery
  util.ts          seeded random numbers and the players' colours
```

The rules are plain functions over plain objects, with no networking, so they are tested
without a server. **Hidden information never leaves the server**: each browser is sent only
what its player is allowed to see (in Silent Fleet, its own ship, its allies, and what its
radar found).

## Tuning the balance

Every number that matters is at the top of the rules file for its game: `NAVAL` in
`src/game/naval.ts` (action points, costs, ranges, the storm) and `TRADE` in
`src/game/trade.ts`.

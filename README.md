# BirdEye

Personal finance overview: income, stock portfolio, dividends and company valuations.

- `backend/`: .NET 10 Web API (EF Core, PostgreSQL)
- `frontend/`: Angular app
- `docker-compose.yml`: local PostgreSQL

## Run locally

```bash
docker compose up -d                                          # PostgreSQL on localhost:5432
cd backend/src/BirdEye.Api && dotnet run --launch-profile http  # API on http://localhost:5248
cd frontend && npm install && npm start                         # app on http://localhost:4200
```

In Development the API applies pending migrations on start.

## Accounts and sign-in

Every page and API call needs a signed-in account (email + password, at least 10 characters). Sessions use an HttpOnly, SameSite=Lax
cookie (14 days, sliding); 5 wrong passwords lock the account for 5 minutes. All data (people, income, transactions, expenses) belongs
to one account and is filtered by owner in the database layer, so one account can never read or change another's rows.

**First account.** While no account exists, the API log prints `Setup code for creating the first one: XXXX-XXXX`. The "Create your
account" page asks for it, because the first account also receives the data that predates accounts. After that, registration is closed;
set `Auth__AllowRegistration=true` to let more people sign up (each gets their own, empty, data).

**Forgot the password?** There is no email reset (no mail service). From the server: sign-in is by email, so delete the account and
register again, handing the data back first:

```bash
docker exec birdeye-db psql -U birdeye -d birdeye -c '
  UPDATE "People" SET "UserId"=''; UPDATE "IncomeSources" SET "UserId"='';
  UPDATE "StockTransactions" SET "UserId"=''; UPDATE "Expenses" SET "UserId"='';
  DELETE FROM "AspNetUsers";'
# restart the API, read the new setup code from its log, create the account again: it receives everything back
```

Backups: `backend/backups/` (git-ignored) holds a `pg_dump` taken before the accounts migration.

## Credits

Add fixed-rate loans (annuity: equal monthly instalments) with amount, interest rate, start date and term. For each loan the page shows what is left to pay until the end (principal plus interest), the end date and the interest still ahead.

- **Your payments.** Without any recorded payment the figures assume every instalment due so far was paid on time. Use *+ Add payment* to record what you really paid (an instalment, part of one, or an extra amount); from then on the balance follows your payments: interest is added every month on the instalment date, a missed month lets it pile up, and extra payments bring the end date forward. *Record the N instalments as paid* fills in the instalments due so far in one click. A payment made before an instalment date counts towards that instalment.
- **Early repayment.** A lump sum or an extra amount every month, either shortening the term (same instalment) or reducing the instalment (same end date), with the interest saved after any early repayment fee. It starts from the real balance.
- **Snowball vs avalanche.** Compares paying the smallest balance first with the highest rate first, with a fixed monthly budget, against paying only the minimums. Everything is converted to RON at today's BNR rate.

Limits: fixed rate only; loan instalments are not added to Expenses automatically.

## Theme

Light and dark, switched with the sun/moon button in the header. It follows the device setting until you choose one,
then remembers the choice in the browser. Colours are CSS variables in `frontend/src/styles.scss` (`:root` for dark,
`:root[data-theme='light']` for light); new components should use the variables, not literal colours.

## Open it from a phone (same Wi-Fi)

```bash
cd frontend && npm run start:lan        # instead of `npm start`
```

Then open `http://<this-mac's-ip>:4200` (find it with `ipconfig getifaddr en0`) or `http://<computer-name>.local:4200`.
The browser only talks to the dev server, which forwards `/api` to the backend, so the API (5248) and PostgreSQL (5432)
stay bound to localhost. The app has no login: anyone on the same network who knows the address can read and change the data,
so use it on a network you trust and never forward the port to the internet.

## Database

The connection string is `ConnectionStrings:Default`. `appsettings.Development.json` holds the local, throwaway
password from `docker-compose.yml`; in any other environment set `ConnectionStrings__Default` instead.

```bash
# new migration after changing the model (run from backend/)
dotnet ef migrations add <Name> --project src/BirdEye.Infrastructure --startup-project src/BirdEye.Api
# apply migrations explicitly
dotnet ef database update --project src/BirdEye.Infrastructure --startup-project src/BirdEye.Api

# backup / restore
docker exec birdeye-db pg_dump -U birdeye -Fc birdeye > birdeye.dump
docker exec -i birdeye-db pg_restore -U birdeye -d birdeye --clean --if-exists < birdeye.dump
```

Data is kept in the `birdeye-pgdata` Docker volume: it survives `docker compose down`, and `docker compose down -v` wipes it.
`backend/backups/` holds the SQLite file the app used before PostgreSQL.

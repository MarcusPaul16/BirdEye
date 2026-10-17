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

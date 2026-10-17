using System.Net.Http.Json;
using BirdEye.Api.Auth;
using BirdEye.Domain.MarketData;
using BirdEye.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BirdEye.Tests.Integration;

/// <summary>The whole application on a throwaway in-memory SQLite database, with the network-bound services replaced.</summary>
public sealed class AppFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly bool _allowRegistration;

    static AppFactory() =>
        // Program reads the connection string while it registers services, before test settings can reach it.
        Environment.SetEnvironmentVariable("ConnectionStrings__Default", "Host=unused");

    public AppFactory(bool allowRegistration = false)
    {
        _allowRegistration = allowRegistration;
        _connection.Open();
        using var db = new BirdEyeDbContext(new DbContextOptionsBuilder<BirdEyeDbContext>().UseSqlite(_connection).Options);
        db.Database.EnsureCreated(); // the schema must exist before the app starts: startup looks for existing accounts
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Auth:AllowRegistration", _allowRegistration ? "true" : "false");
        builder.UseSetting("Auth:RequestsPerMinute", "100000");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<BirdEyeDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<BirdEyeDbContext>>();
            services.AddDbContext<BirdEyeDbContext>(o => o.UseSqlite(_connection));

            services.RemoveAll<IMarketDataProvider>();
            services.RemoveAll<IFxRateProvider>();
            services.AddSingleton<IMarketDataProvider, OfflineMarketData>();
            services.AddSingleton<IFxRateProvider, FlatFx>();
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) _connection.Dispose();
    }

    public string SetupCode => Services.GetRequiredService<SetupCode>().Current ?? throw new InvalidOperationException("No setup code is active.");

    /// <summary>A client with its own cookie jar (its own browser) and the header the API requires on state-changing calls.</summary>
    public HttpClient Browser(bool withCsrfHeader = true)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true, AllowAutoRedirect = false });
        if (withCsrfHeader) client.DefaultRequestHeaders.Add("X-Requested-With", "test");
        return client;
    }

    public async Task<HttpResponseMessage> Register(HttpClient browser, string email, string password = "correct horse battery", string? setupCode = null) =>
        await browser.PostAsJsonAsync("/api/auth/register", new { email, password, setupCode });

    /// <summary>Creates the first account (with the right setup code) and returns a signed-in browser.</summary>
    public async Task<HttpClient> FirstUser(string email = "owner@example.com", string password = "correct horse battery")
    {
        var browser = Browser();
        var response = await Register(browser, email, password, SetupCode);
        response.EnsureSuccessStatusCode();
        return browser;
    }

    /// <summary>Creates a further account; needs the factory to have been made with registration open.</summary>
    public async Task<HttpClient> AnotherUser(string email, string password = "correct horse battery")
    {
        var browser = Browser();
        (await Register(browser, email, password)).EnsureSuccessStatusCode();
        return browser;
    }

    /// <summary>Inserts rows that predate accounts (empty owner) the way an old database would have them.</summary>
    public async Task SeedLegacyRows()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BirdEyeDbContext>();
        await db.Database.ExecuteSqlRawAsync("""INSERT INTO "People" ("Name", "UserId") VALUES ('Legacy Paul', '')""");
        await db.Database.ExecuteSqlRawAsync("""INSERT INTO "IncomeSources" ("PersonId", "Name", "Type", "Amount", "Currency", "Frequency", "UserId") SELECT "Id", 'Legacy salary', 'Salary', 5000, 'RON', 'Monthly', '' FROM "People" WHERE "Name" = 'Legacy Paul'""");
        await db.Database.ExecuteSqlRawAsync("""INSERT INTO "StockTransactions" ("Symbol", "Type", "Quantity", "Price", "Fees", "Currency", "Date", "UserId") VALUES ('KO', 'Buy', 3, 60, 0, 'USD', '2026-01-02', '')""");
        await db.Database.ExecuteSqlRawAsync("""INSERT INTO "Expenses" ("Name", "Category", "Amount", "Currency", "Date", "Recurrence", "UserId") VALUES ('Legacy rent', 'Housing', 2000, 'RON', '2026-01-01', 'Monthly', '')""");
    }
}

internal sealed class FlatFx : IFxRateProvider
{
    public Task<decimal> ConvertAsync(decimal amount, string from, string to, CancellationToken ct = default) =>
        Task.FromResult(string.Equals(from, to, StringComparison.OrdinalIgnoreCase) ? amount : amount * 5m);
}

internal sealed class OfflineMarketData : IMarketDataProvider
{
    private static NotSupportedException Offline() => new("Market data is not available in tests.");
    public Task<Quote> GetQuoteAsync(string symbol, CancellationToken ct = default) => throw Offline();
    public Task<CompanyProfile> GetProfileAsync(string symbol, CancellationToken ct = default) => throw Offline();
    public Task<IReadOnlyList<DividendPayment>> GetDividendsAsync(string symbol, CancellationToken ct = default) => throw Offline();
    public Task<IReadOnlyList<PricePoint>> GetPriceHistoryAsync(string symbol, DateOnly from, DateOnly to, CancellationToken ct = default) => throw Offline();
    public Task<UpcomingDividend?> GetUpcomingDividendAsync(string symbol, CancellationToken ct = default) => throw Offline();
    public Task<CompanyFundamentals> GetFundamentalsAsync(string symbol, CancellationToken ct = default) => throw Offline();
    public Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, CancellationToken ct = default) => throw Offline();
}

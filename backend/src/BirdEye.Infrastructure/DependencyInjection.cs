using System.Net;
using BirdEye.Domain.MarketData;
using BirdEye.Infrastructure.MarketData;
using BirdEye.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BirdEye.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        var connection = config.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured (PostgreSQL). See README.md.");
        // Retries transient failures, such as a pooled connection the server closed because the database restarted.
        services.AddDbContext<BirdEyeDbContext>(o => o.UseNpgsql(connection, npgsql => npgsql.EnableRetryOnFailure()));
        services.AddMemoryCache();

        services.AddHttpClient<IFxRateProvider, BnrFxRateProvider>();
        // One cookie jar for the app's lifetime: Yahoo's crumb is only valid together with the cookie it was issued for,
        // and the factory recycles handlers every couple of minutes.
        var yahooCookies = new CookieContainer();
        services.AddHttpClient<IMarketDataProvider, YahooMarketDataProvider>(c =>
                c.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0"))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { CookieContainer = yahooCookies, UseCookies = true });
        return services;
    }
}

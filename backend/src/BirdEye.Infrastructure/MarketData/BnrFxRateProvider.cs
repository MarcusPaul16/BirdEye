using System.Globalization;
using System.Xml.Linq;
using BirdEye.Domain.MarketData;
using Microsoft.Extensions.Caching.Memory;

namespace BirdEye.Infrastructure.MarketData;

/// <summary>Official National Bank of Romania reference rates (published once per business day).</summary>
public class BnrFxRateProvider(HttpClient http, IMemoryCache cache) : IFxRateProvider
{
    public const string Url = "https://curs.bnr.ro/nbrfxrates.xml";

    public async Task<decimal> ConvertAsync(decimal amount, string from, string to, CancellationToken ct = default)
    {
        from = from.ToUpperInvariant();
        to = to.ToUpperInvariant();
        if (from == to) return amount;

        var rates = await GetRatesAsync(ct);
        return amount * RonPer(rates, from) / RonPer(rates, to);
    }

    private static decimal RonPer(IReadOnlyDictionary<string, decimal> rates, string currency) =>
        currency == "RON" ? 1m
        : rates.TryGetValue(currency, out var r) ? r
        : throw new NotSupportedException($"BNR publishes no rate for {currency}.");

    private async Task<IReadOnlyDictionary<string, decimal>> GetRatesAsync(CancellationToken ct) =>
        (await cache.GetOrCreateAsync("bnr-rates", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
            return Parse(await http.GetStringAsync(Url, ct));
        }))!;

    public static IReadOnlyDictionary<string, decimal> Parse(string xml) =>
        XDocument.Parse(xml).Descendants().Where(x => x.Name.LocalName == "Rate")
            .ToDictionary(
                x => (string)x.Attribute("currency")!,
                x => decimal.Parse(x.Value, CultureInfo.InvariantCulture)
                     / (decimal.TryParse((string?)x.Attribute("multiplier"), out var m) ? m : 1m));
}

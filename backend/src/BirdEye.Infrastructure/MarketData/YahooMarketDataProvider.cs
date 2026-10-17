using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using BirdEye.Domain.MarketData;
using Microsoft.Extensions.Caching.Memory;

namespace BirdEye.Infrastructure.MarketData;

/// <summary>
/// Free, keyless market data from Yahoo Finance's unofficial endpoints. Good enough for personal use,
/// but it can change or throttle without notice: keep it behind <see cref="IMarketDataProvider"/>.
/// </summary>
public class YahooMarketDataProvider(HttpClient http, IMemoryCache cache) : IMarketDataProvider
{
    private const string Chart = "https://query1.finance.yahoo.com/v8/finance/chart/";
    /// <summary>Yahoo publishes ex-dates only. US issuers typically pay ~2 weeks later (Realty Income: ex ~1st, paid 15th).</summary>
    private const int EstimatedPayLagDays = 14;
    private const string Summary = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/";

    public async Task<Quote> GetQuoteAsync(string symbol, CancellationToken ct = default)
    {
        var meta = (await ChartAsync(symbol, "5d", ct)).GetProperty("meta");
        var (factor, currency) = MajorUnit(meta.GetProperty("currency").GetString()!);
        return new Quote(
            meta.GetProperty("symbol").GetString()!,
            meta.GetProperty("regularMarketPrice").GetDecimal() * factor,
            currency,
            DateTimeOffset.FromUnixTimeSeconds(meta.GetProperty("regularMarketTime").GetInt64()));
    }

    public async Task<IReadOnlyList<DividendPayment>> GetDividendsAsync(string symbol, CancellationToken ct = default)
    {
        var result = await ChartAsync(symbol, "max", ct);
        var (factor, currency) = MajorUnit(result.GetProperty("meta").GetProperty("currency").GetString()!);
        if (!result.TryGetProperty("events", out var events) || !events.TryGetProperty("dividends", out var divs))
            return [];

        return divs.EnumerateObject()
            .Select(d =>
            {
                var ex = DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds(d.Value.GetProperty("date").GetInt64()).UtcDateTime);
                return new DividendPayment(ex, ex.AddDays(EstimatedPayLagDays), d.Value.GetProperty("amount").GetDecimal() * factor, currency, true);
            })
            .OrderBy(d => d.ExDate)
            .ToList();
    }

    public async Task<IReadOnlyList<PricePoint>> GetPriceHistoryAsync(string symbol, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var result = await ChartAsync(symbol, "max", ct);
        var (factor, _) = MajorUnit(result.GetProperty("meta").GetProperty("currency").GetString()!);
        if (!result.TryGetProperty("timestamp", out var ts)) return [];
        var closes = result.GetProperty("indicators").GetProperty("quote")[0].GetProperty("close");

        return ts.EnumerateArray().Zip(closes.EnumerateArray())
            .Where(p => p.Second.ValueKind == JsonValueKind.Number)
            .Select(p => new PricePoint(DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds(p.First.GetInt64()).UtcDateTime), p.Second.GetDecimal() * factor))
            .Where(p => p.Date >= from && p.Date <= to)
            .ToList();
    }

    public async Task<CompanyProfile> GetProfileAsync(string symbol, CancellationToken ct = default)
    {
        symbol = symbol.ToUpperInvariant();
        return (await cache.GetOrCreateAsync($"yahoo-profile:{symbol}", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
            return await LoadProfileAsync(symbol, ct);
        }))!;
    }

    private async Task<CompanyProfile> LoadProfileAsync(string symbol, CancellationToken ct)
    {
        using var doc = await SummaryAsync(symbol, "assetProfile,price,summaryDetail", ct);
        var r = doc!.RootElement.GetProperty("quoteSummary").GetProperty("result")[0];

        string? Str(string module, string name) =>
            r.TryGetProperty(module, out var m) && m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        decimal? Raw(string module, string name) =>
            r.TryGetProperty(module, out var m) && m.TryGetProperty(name, out var v) && v.TryGetProperty("raw", out var raw) && raw.ValueKind == JsonValueKind.Number
                ? raw.GetDecimal() : null;

        return new CompanyProfile(symbol, Str("price", "longName") ?? Str("price", "shortName") ?? symbol,
            Str("assetProfile", "sector"), Str("assetProfile", "industry"), Str("assetProfile", "country"),
            Str("assetProfile", "website"), Str("assetProfile", "longBusinessSummary"),
            Raw("summaryDetail", "dividendYield"));
    }

    public async Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, CancellationToken ct = default)
    {
        // Yahoo returns nothing for "legal and general" but finds "legal & general": the spelled-out "and" is the problem.
        query = System.Text.RegularExpressions.Regex.Replace(query, @"\band\b", "&", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var url = $"https://query1.finance.yahoo.com/v1/finance/search?q={Uri.EscapeDataString(query)}&quotesCount=8&newsCount=0";
        using var doc = await http.GetFromJsonAsync<JsonDocument>(url, ct);
        if (!doc!.RootElement.TryGetProperty("quotes", out var quotes)) return [];

        string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return quotes.EnumerateArray()
            .Where(q => Str(q, "quoteType") is "EQUITY" or "ETF")
            .Select(q => new SymbolMatch(Str(q, "symbol")!, Str(q, "longname") ?? Str(q, "shortname") ?? Str(q, "symbol")!, Str(q, "exchDisp"), Str(q, "quoteType")))
            .ToList();
    }

    /// <summary>
    /// London, Tel Aviv and Johannesburg quote in minor units (GBp, ILA, ZAc). Everything downstream assumes major units,
    /// otherwise FX conversion would be off by a factor of 100.
    /// </summary>
    private static (decimal Factor, string Currency) MajorUnit(string currency) => currency switch
    {
        "GBp" or "GBX" => (0.01m, "GBP"),
        "ILA" => (0.01m, "ILS"),
        "ZAc" or "ZAC" => (0.01m, "ZAR"),
        _ => (1m, currency),
    };

    public async Task<CompanyFundamentals> GetFundamentalsAsync(string symbol, CancellationToken ct = default)
    {
        symbol = symbol.ToUpperInvariant();
        return (await cache.GetOrCreateAsync($"yahoo-fundamentals:{symbol}", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
            return await LoadFundamentalsAsync(symbol, ct);
        }))!;
    }

    private async Task<CompanyFundamentals> LoadFundamentalsAsync(string symbol, CancellationToken ct)
    {
        using var doc = await SummaryAsync(symbol, "financialData,defaultKeyStatistics,earningsTrend,summaryDetail,price", ct);
        var r = doc.RootElement.GetProperty("quoteSummary").GetProperty("result")[0];

        decimal? Raw(string module, string name) =>
            r.TryGetProperty(module, out var m) && m.TryGetProperty(name, out var v) && v.TryGetProperty("raw", out var raw) && raw.ValueKind == JsonValueKind.Number
                ? raw.GetDecimal() : null;
        string? Str(string module, string name) =>
            r.TryGetProperty(module, out var m) && m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        decimal? nextYearGrowth = null;
        if (r.TryGetProperty("earningsTrend", out var et) && et.TryGetProperty("trend", out var trend))
            foreach (var t in trend.EnumerateArray())
                if (t.TryGetProperty("period", out var period) && period.GetString() == "+1y"
                    && t.TryGetProperty("growth", out var g) && g.TryGetProperty("raw", out var raw) && raw.ValueKind == JsonValueKind.Number)
                    nextYearGrowth = raw.GetDecimal();

        // The analyst target is a price, so it is quoted in the trading currency, which may be a minor unit (pence).
        var (factor, _) = MajorUnit(Str("price", "currency") ?? "");

        var series = await AnnualSeriesAsync(symbol, ["annualFreeCashFlow", "annualDilutedEPS"], ct);

        return new CompanyFundamentals(
            symbol, Str("financialData", "financialCurrency"),
            Raw("defaultKeyStatistics", "sharesOutstanding"), Raw("financialData", "freeCashflow"),
            Raw("financialData", "totalDebt"), Raw("financialData", "totalCash"),
            Raw("defaultKeyStatistics", "trailingEps"), Raw("defaultKeyStatistics", "forwardEps"), Raw("defaultKeyStatistics", "bookValue"),
            Raw("defaultKeyStatistics", "beta"), nextYearGrowth, Raw("summaryDetail", "trailingPE"), Raw("financialData", "targetMeanPrice") * factor,
            series.GetValueOrDefault("annualFreeCashFlow", []), series.GetValueOrDefault("annualDilutedEPS", []));
    }

    /// <summary>Annual financial statement series from Yahoo's fundamentals-timeseries endpoint (a few years per series).</summary>
    private async Task<Dictionary<string, IReadOnlyList<AnnualValue>>> AnnualSeriesAsync(string symbol, string[] types, CancellationToken ct)
    {
        var result = new Dictionary<string, IReadOnlyList<AnnualValue>>();
        try
        {
            var crumb = await CrumbAsync(ct);
            var url = $"https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{Uri.EscapeDataString(symbol)}" +
                      $"?type={string.Join(',', types)}&merge=false&period1=1300000000&period2={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}&crumb={Uri.EscapeDataString(crumb)}";
            using var doc = await http.GetFromJsonAsync<JsonDocument>(url, ct);
            foreach (var item in doc!.RootElement.GetProperty("timeseries").GetProperty("result").EnumerateArray())
            {
                var type = item.GetProperty("meta").GetProperty("type")[0].GetString()!;
                if (!item.TryGetProperty(type, out var points) || points.ValueKind != JsonValueKind.Array) continue;
                result[type] = points.EnumerateArray()
                    .Where(p => p.ValueKind == JsonValueKind.Object && p.TryGetProperty("reportedValue", out var rv) && rv.TryGetProperty("raw", out _))
                    .Select(p => new AnnualValue(
                        int.Parse(p.GetProperty("asOfDate").GetString()![..4], CultureInfo.InvariantCulture),
                        p.GetProperty("reportedValue").GetProperty("raw").GetDecimal()))
                    .OrderBy(a => a.Year).ToList();
            }
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or KeyNotFoundException or InvalidOperationException)
        {
            // History only sharpens the growth estimate and the P/E model; the models cope without it.
        }
        return result;
    }

    private async Task<JsonElement> ChartAsync(string symbol, string range, CancellationToken ct)
    {
        symbol = symbol.ToUpperInvariant();
        var doc = await cache.GetOrCreateAsync($"yahoo-chart:{symbol}:{range}", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(range == "max" ? 60 : 5);
            // range=max silently degrades to quarterly bars; explicit period bounds keep daily resolution.
            var span = range == "max" ? $"period1=0&period2={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}" : $"range={range}";
            var url = $"{Chart}{Uri.EscapeDataString(symbol)}?{span}&interval=1d&events=div";
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode) throw new KeyNotFoundException($"No market data for '{symbol}'.");
            return (await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct)).RootElement.Clone();
        });
        return doc.GetProperty("chart").GetProperty("result")[0];
    }

    private async Task<JsonDocument> SummaryAsync(string symbol, string modules, CancellationToken ct)
    {
        // A stale crumb yields 401: drop it and retry once with a fresh one.
        for (var attempt = 0; ; attempt++)
        {
            var crumb = await CrumbAsync(ct);
            var url = $"{Summary}{Uri.EscapeDataString(symbol)}?modules={modules}&crumb={Uri.EscapeDataString(crumb)}";
            using var resp = await http.GetAsync(url, ct);
            if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized && attempt == 0) { cache.Remove("yahoo-crumb"); continue; }
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) throw new KeyNotFoundException($"No market data for '{symbol}'.");
            resp.EnsureSuccessStatusCode();
            return await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        }
    }

    private async Task<string> CrumbAsync(CancellationToken ct) =>
        (await cache.GetOrCreateAsync("yahoo-crumb", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1);
            // The cookie lands in the handler's CookieContainer; the crumb is then tied to it.
            await http.GetAsync("https://fc.yahoo.com", ct);
            return await http.GetStringAsync("https://query1.finance.yahoo.com/v1/test/getcrumb", ct);
        }))!;
}

using BirdEye.Infrastructure.MarketData;

namespace BirdEye.Tests;

public class BnrFxRateProviderTests
{
    private const string Xml = """
        <DataSet xmlns="https://www.bnr.ro/xsd"><Body><Cube date="2026-10-16">
        <Rate currency="USD">4.7430</Rate><Rate currency="HUF" multiplier="100">1.4695</Rate>
        </Cube></Body></DataSet>
        """;

    [Fact]
    public void Parses_rates_and_applies_multiplier()
    {
        var rates = BnrFxRateProvider.Parse(Xml);
        Assert.Equal(4.7430m, rates["USD"]);
        Assert.Equal(0.014695m, rates["HUF"]);
    }
}

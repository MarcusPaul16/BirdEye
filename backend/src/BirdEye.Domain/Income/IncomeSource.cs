namespace BirdEye.Domain.Income;

public enum IncomeType { Salary, Freelance, Rental, Dividends, Other }

public enum IncomeFrequency { OneTime, Monthly, Yearly }

public class IncomeSource
{
    public int Id { get; set; }
    public int PersonId { get; set; }
    public Person? Person { get; set; }
    public required string Name { get; set; }
    public IncomeType Type { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "RON";
    public IncomeFrequency Frequency { get; set; } = IncomeFrequency.Monthly;

    public decimal MonthlyEquivalent => Frequency switch
    {
        IncomeFrequency.Monthly => Amount,
        IncomeFrequency.Yearly => Amount / 12m,
        _ => 0m
    };
}

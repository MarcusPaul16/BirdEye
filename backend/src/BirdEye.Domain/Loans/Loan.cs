namespace BirdEye.Domain.Loans;

/// <summary>
/// A fixed-rate loan repaid in equal monthly instalments (an annuity), the usual consumer loan or mortgage. The first instalment falls one month
/// after <see cref="StartDate"/>, on the same day of the month, and there are <see cref="Months"/> of them.
/// </summary>
public class Loan : IOwnedByUser
{
    public int Id { get; set; }
    public string UserId { get; set; } = "";
    public required string Name { get; set; }
    public decimal Principal { get; set; }
    public string Currency { get; set; } = "RON";

    /// <summary>Nominal yearly interest in percent (7.25 means 7.25%).</summary>
    public decimal AnnualRatePercent { get; set; }

    public DateOnly StartDate { get; set; }
    public int Months { get; set; }

    /// <summary>Fee charged on the amount repaid early, in percent. Zero when the contract has none.</summary>
    public decimal EarlyRepaymentFeePercent { get; set; }
}

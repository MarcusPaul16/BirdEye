namespace BirdEye.Domain.Loans;

/// <summary>A payment actually made towards a loan: an instalment, a part of one, or an extra amount on top.</summary>
public class LoanPayment : IOwnedByUser
{
    public int Id { get; set; }
    public string UserId { get; set; } = "";
    public int LoanId { get; set; }
    public DateOnly Date { get; set; }
    public decimal Amount { get; set; }
    public string? Note { get; set; }
}

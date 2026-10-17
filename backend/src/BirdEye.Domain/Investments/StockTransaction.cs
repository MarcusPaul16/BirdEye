namespace BirdEye.Domain.Investments;

public enum TransactionType { Buy, Sell }

public class StockTransaction
{
    public int Id { get; set; }
    public required string Symbol { get; set; }
    public TransactionType Type { get; set; }
    public decimal Quantity { get; set; }
    public decimal Price { get; set; }
    public decimal Fees { get; set; }
    public string Currency { get; set; } = "USD";
    public DateOnly Date { get; set; }
}

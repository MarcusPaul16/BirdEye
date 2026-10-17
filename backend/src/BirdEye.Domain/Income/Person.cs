namespace BirdEye.Domain.Income;

public class Person
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public List<IncomeSource> IncomeSources { get; set; } = [];
}

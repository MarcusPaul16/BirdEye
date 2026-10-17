namespace BirdEye.Domain.Income;

public class Person : IOwnedByUser
{
    public string UserId { get; set; } = "";
    public int Id { get; set; }
    public required string Name { get; set; }
    public List<IncomeSource> IncomeSources { get; set; } = [];
}

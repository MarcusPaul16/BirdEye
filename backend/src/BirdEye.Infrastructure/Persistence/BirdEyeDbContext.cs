using BirdEye.Domain.Income;
using BirdEye.Domain.Investments;
using Microsoft.EntityFrameworkCore;

namespace BirdEye.Infrastructure.Persistence;

public class BirdEyeDbContext(DbContextOptions<BirdEyeDbContext> options) : DbContext(options)
{
    public DbSet<Person> People => Set<Person>();
    public DbSet<IncomeSource> IncomeSources => Set<IncomeSource>();
    public DbSet<StockTransaction> StockTransactions => Set<StockTransaction>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Person>().HasMany(p => p.IncomeSources).WithOne(i => i.Person).HasForeignKey(i => i.PersonId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<IncomeSource>(e =>
        {
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.Type).HasConversion<string>();
            e.Property(x => x.Frequency).HasConversion<string>();
            e.Ignore(x => x.MonthlyEquivalent);
        });
        b.Entity<StockTransaction>(e =>
        {
            e.Property(x => x.Quantity).HasPrecision(18, 6);
            e.Property(x => x.Price).HasPrecision(18, 6);
            e.Property(x => x.Fees).HasPrecision(18, 2);
            e.Property(x => x.Type).HasConversion<string>();
            e.HasIndex(x => x.Symbol);
        });
    }
}

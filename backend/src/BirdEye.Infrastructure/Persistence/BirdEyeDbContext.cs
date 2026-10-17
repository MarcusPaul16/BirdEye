using BirdEye.Domain;
using BirdEye.Domain.Expenses;
using BirdEye.Domain.Income;
using BirdEye.Domain.Investments;
using BirdEye.Domain.Loans;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace BirdEye.Infrastructure.Persistence;

/// <summary>
/// The application database: the Identity tables plus the user's data. Every owned entity carries a <see cref="IOwnedByUser.UserId"/>;
/// a global query filter restricts reads, updates and deletes to the signed-in user's rows, and new rows are stamped with their id on save.
/// With nobody signed in the filter matches nothing, so isolation holds by default instead of depending on each query remembering it.
/// </summary>
public class BirdEyeDbContext(DbContextOptions<BirdEyeDbContext> options, ICurrentUser? currentUser = null) : IdentityDbContext<IdentityUser>(options)
{
    public DbSet<Person> People => Set<Person>();
    public DbSet<IncomeSource> IncomeSources => Set<IncomeSource>();
    public DbSet<StockTransaction> StockTransactions => Set<StockTransaction>();
    public DbSet<Expense> Expenses => Set<Expense>();
    public DbSet<Loan> Loans => Set<Loan>();
    public DbSet<LoanPayment> LoanPayments => Set<LoanPayment>();

    /// <summary>Read by the query filters on every query (EF re-evaluates it per execution, so one context instance can safely serve one request).</summary>
    private string? CurrentUserId => currentUser?.Id;

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<Person>(e =>
        {
            e.HasMany(p => p.IncomeSources).WithOne(i => i.Person).HasForeignKey(i => i.PersonId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.UserId);
            e.HasQueryFilter(x => x.UserId == CurrentUserId);
        });
        b.Entity<IncomeSource>(e =>
        {
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.Type).HasConversion<string>();
            e.Property(x => x.Frequency).HasConversion<string>();
            e.Ignore(x => x.MonthlyEquivalent);
            e.HasIndex(x => x.UserId);
            e.HasQueryFilter(x => x.UserId == CurrentUserId);
        });
        b.Entity<Expense>(e =>
        {
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.Category).HasConversion<string>();
            e.Property(x => x.Recurrence).HasConversion<string>();
            e.Ignore(x => x.IsRecurring);
            e.HasIndex(x => new { x.UserId, x.Date });
            e.HasQueryFilter(x => x.UserId == CurrentUserId);
        });
        b.Entity<Loan>(e =>
        {
            e.Property(x => x.Principal).HasPrecision(18, 2);
            e.Property(x => x.AnnualRatePercent).HasPrecision(9, 4);
            e.Property(x => x.EarlyRepaymentFeePercent).HasPrecision(5, 2);
            e.HasIndex(x => x.UserId);
            e.HasQueryFilter(x => x.UserId == CurrentUserId);
        });
        b.Entity<LoanPayment>(e =>
        {
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.Note).HasMaxLength(200);
            e.HasOne<Loan>().WithMany().HasForeignKey(x => x.LoanId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.LoanId, x.Date });
            e.HasIndex(x => x.UserId);
            e.HasQueryFilter(x => x.UserId == CurrentUserId);
        });
        b.Entity<StockTransaction>(e =>
        {
            e.Property(x => x.Quantity).HasPrecision(18, 6);
            e.Property(x => x.Price).HasPrecision(18, 6);
            e.Property(x => x.Fees).HasPrecision(18, 2);
            e.Property(x => x.Type).HasConversion<string>();
            e.HasIndex(x => new { x.UserId, x.Symbol });
            e.HasQueryFilter(x => x.UserId == CurrentUserId);
        });
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        Stamp();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        Stamp();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>New rows get the signed-in user's id; an owner can never be reassigned, and nothing is saved on behalf of nobody.</summary>
    private void Stamp()
    {
        foreach (var entry in ChangeTracker.Entries<IOwnedByUser>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.UserId = CurrentUserId is { Length: > 0 } id
                        ? id
                        : throw new InvalidOperationException("Cannot save user data without a signed-in user.");
                    break;
                case EntityState.Modified when entry.Property(x => x.UserId).IsModified:
                    throw new InvalidOperationException("The owner of a row cannot be changed.");
            }
        }
    }

    /// <summary>
    /// Gives every row that predates accounts (empty owner) to <paramref name="userId"/>. Meant for the first account only; returns how many
    /// rows of each kind were claimed.
    /// </summary>
    public async Task<(int People, int IncomeSources, int Transactions, int Expenses)> ClaimLegacyDataAsync(string userId, CancellationToken ct = default)
    {
        var people = await People.IgnoreQueryFilters().Where(x => x.UserId == "").ExecuteUpdateAsync(s => s.SetProperty(x => x.UserId, userId), ct);
        var income = await IncomeSources.IgnoreQueryFilters().Where(x => x.UserId == "").ExecuteUpdateAsync(s => s.SetProperty(x => x.UserId, userId), ct);
        var transactions = await StockTransactions.IgnoreQueryFilters().Where(x => x.UserId == "").ExecuteUpdateAsync(s => s.SetProperty(x => x.UserId, userId), ct);
        var expenses = await Expenses.IgnoreQueryFilters().Where(x => x.UserId == "").ExecuteUpdateAsync(s => s.SetProperty(x => x.UserId, userId), ct);
        await Loans.IgnoreQueryFilters().Where(x => x.UserId == "").ExecuteUpdateAsync(s => s.SetProperty(x => x.UserId, userId), ct);
        return (people, income, transactions, expenses);
    }
}

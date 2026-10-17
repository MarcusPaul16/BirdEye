namespace BirdEye.Infrastructure.Persistence;

/// <summary>The signed-in user of the current request, as the data layer needs to know them. Null outside a request, or when nobody is signed in.</summary>
public interface ICurrentUser
{
    string? Id { get; }
}

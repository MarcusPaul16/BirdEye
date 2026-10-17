namespace BirdEye.Domain;

/// <summary>Data that belongs to exactly one user. The data layer filters on it and stamps it, so a user can only ever see and change their own rows.</summary>
public interface IOwnedByUser
{
    /// <summary>The Identity user id of the owner. Empty only for rows that predate accounts and have not been claimed yet.</summary>
    string UserId { get; set; }
}

using System.Security.Cryptography;

namespace BirdEye.Api.Auth;

/// <summary>
/// A one-time code needed to create the very first account. Before any account exists, whoever registers first would also receive the data
/// that predates accounts, so the first registration has to prove access to the server: the code is only written to the server log.
/// It lives in memory (a new one is made on each start while no account exists) and is discarded once the first account is created.
/// </summary>
public class SetupCode
{
    // No 0/O/1/I/L: the code is read from a log and typed by hand.
    private const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private string? _code;

    public string? Current => _code;

    public string Generate()
    {
        Span<char> chars = stackalloc char[9];
        for (var i = 0; i < chars.Length; i++)
            chars[i] = i == 4 ? '-' : Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return _code = new string(chars);
    }

    public void Clear() => _code = null;

    /// <summary>Constant-time comparison, ignoring case, spaces and the dash.</summary>
    public bool Matches(string? candidate)
    {
        if (_code is null || candidate is null) return false;
        static string Normalise(string s) => s.Replace("-", "").Replace(" ", "").ToUpperInvariant();
        var a = System.Text.Encoding.UTF8.GetBytes(Normalise(_code));
        var b = System.Text.Encoding.UTF8.GetBytes(Normalise(candidate));
        return CryptographicOperations.FixedTimeEquals(a, b);
    }
}

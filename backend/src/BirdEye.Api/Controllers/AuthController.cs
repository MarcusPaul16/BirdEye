using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using BirdEye.Api.Auth;
using BirdEye.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace BirdEye.Api.Controllers;

public record RegisterRequest(string Email, string Password, string? SetupCode);
public record LoginRequest(string Email, string Password, bool RememberMe);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

[ApiController]
[Route("api/auth")]
public class AuthController(
    UserManager<IdentityUser> users, SignInManager<IdentityUser> signIn, BirdEyeDbContext db,
    SetupCode setupCode, IConfiguration config, ILogger<AuthController> log) : ControllerBase
{
    /// <summary>Two people registering at the same moment must not both count as "the first account".</summary>
    private static readonly SemaphoreSlim RegistrationLock = new(1, 1);

    private const string BadCredentials = "Invalid email or password.";

    /// <summary>Who is signed in, and whether anyone can create an account (the first one needs the setup code from the server log).</summary>
    [HttpGet("status")]
    [AllowAnonymous]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        var any = await users.Users.AnyAsync(ct);
        return Ok(new
        {
            authenticated = User.Identity?.IsAuthenticated == true,
            email = User.FindFirstValue(ClaimTypes.Email),
            registrationOpen = !any || config.GetValue("Auth:AllowRegistration", false),
            setupCodeRequired = !any,
        });
    }

    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Register(RegisterRequest r, CancellationToken ct)
    {
        if (!new EmailAddressAttribute().IsValid(r.Email) || r.Email.Length > 254) return BadRequest(new { error = "Enter a valid email address." });
        if (r.Password is null or { Length: > 128 }) return BadRequest(new { error = "The password is too long." });

        await RegistrationLock.WaitAsync(ct);
        try
        {
            var first = !await users.Users.AnyAsync(ct);
            if (first)
            {
                if (!setupCode.Matches(r.SetupCode))
                {
                    log.LogWarning("Rejected the first registration: wrong or missing setup code.");
                    return StatusCode(403, new { error = "The setup code is wrong. It is printed in the API log when the server starts." });
                }
            }
            else if (!config.GetValue("Auth:AllowRegistration", false))
            {
                return StatusCode(403, new { error = "Registration is closed." });
            }

            var user = new IdentityUser { UserName = r.Email.Trim(), Email = r.Email.Trim() };
            var created = await users.CreateAsync(user, r.Password);
            if (!created.Succeeded) return BadRequest(new { error = string.Join(" ", created.Errors.Select(Friendly)) });

            object? claimed = null;
            if (first)
            {
                var c = await db.ClaimLegacyDataAsync(user.Id, ct);
                claimed = new { people = c.People, incomeSources = c.IncomeSources, transactions = c.Transactions, expenses = c.Expenses };
                setupCode.Clear();
                log.LogInformation("First account created; {People} people, {Income} income sources, {Tx} transactions and {Exp} expenses attached to it.",
                    c.People, c.IncomeSources, c.Transactions, c.Expenses);
            }

            await signIn.SignInAsync(user, isPersistent: true);
            return Ok(new { email = user.Email, claimed });
        }
        finally { RegistrationLock.Release(); }
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Login(LoginRequest r, CancellationToken ct)
    {
        var user = r.Email is null ? null : await users.FindByEmailAsync(r.Email.Trim());
        if (user is null || r.Password is null)
        {
            // Same answer and similar work for an unknown email, so the response does not reveal which emails have accounts.
            if (r.Password is not null) _ = users.PasswordHasher.HashPassword(new IdentityUser(), r.Password);
            return Unauthorized(new { error = BadCredentials });
        }

        var result = await signIn.PasswordSignInAsync(user, r.Password, r.RememberMe, lockoutOnFailure: true);
        if (result.Succeeded) return Ok(new { email = user.Email });
        if (result.IsLockedOut)
        {
            log.LogWarning("Account {Email} is locked out after repeated failed sign-ins.", user.Email);
            return StatusCode(429, new { error = "Too many failed attempts. Try again in a few minutes." });
        }
        return Unauthorized(new { error = BadCredentials });
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await signIn.SignOutAsync();
        return NoContent();
    }

    [HttpGet("me")]
    public IActionResult Me() => Ok(new { email = User.FindFirstValue(ClaimTypes.Email) });

    [HttpPost("password")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest r)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (r.NewPassword is null or { Length: > 128 }) return BadRequest(new { error = "The new password is too long." });

        var result = await users.ChangePasswordAsync(user, r.CurrentPassword ?? "", r.NewPassword);
        if (!result.Succeeded) return BadRequest(new { error = string.Join(" ", result.Errors.Select(Friendly)) });

        await signIn.RefreshSignInAsync(user); // changing the password rotates the security stamp; keep this session signed in
        return NoContent();
    }

    private static string Friendly(IdentityError e) => e.Code switch
    {
        "PasswordTooShort" => "The password must be at least 10 characters.",
        "PasswordMismatch" => "The current password is wrong.",
        "DuplicateEmail" or "DuplicateUserName" => "An account with this email already exists.",
        "InvalidEmail" or "InvalidUserName" => "Enter a valid email address.",
        _ => e.Description,
    };
}

using System.Security.Claims;
using BirdEye.Infrastructure.Persistence;

namespace BirdEye.Api.Auth;

/// <summary>The signed-in user, read from the request's authentication cookie.</summary>
public class HttpContextCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public string? Id => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
}

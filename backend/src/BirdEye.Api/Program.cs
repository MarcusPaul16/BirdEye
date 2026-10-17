using Microsoft.AspNetCore.RateLimiting;
using BirdEye.Api.Auth;
using BirdEye.Infrastructure;
using BirdEye.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddOpenApi();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:4200").AllowAnyHeader().AllowAnyMethod()));

// ---- accounts ----
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpContextCurrentUser>();
builder.Services.AddSingleton<SetupCode>();

builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies(o =>
    o.ApplicationCookie?.Configure(c =>
    {
        c.Cookie.Name = "birdeye.auth";
        c.Cookie.HttpOnly = true;                                   // not readable from JavaScript
        c.Cookie.SameSite = SameSiteMode.Lax;                       // not sent on cross-site requests
        c.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;   // Secure whenever the site is served over HTTPS
        c.ExpireTimeSpan = TimeSpan.FromDays(14);
        c.SlidingExpiration = true;
        // An API answers with status codes; it does not redirect to a login page.
        c.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        c.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    }));

builder.Services.AddIdentityCore<IdentityUser>(o =>
    {
        o.User.RequireUniqueEmail = true;
        // Length matters more than composition rules: 10+ characters, no forced symbols.
        o.Password.RequiredLength = 10;
        o.Password.RequireDigit = o.Password.RequireLowercase = o.Password.RequireUppercase = o.Password.RequireNonAlphanumeric = false;
        o.Lockout.AllowedForNewUsers = true;
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
    })
    .AddEntityFrameworkStores<BirdEyeDbContext>()
    .AddSignInManager();

// Everything requires a signed-in user unless it opts out with [AllowAnonymous].
builder.Services.AddAuthorizationBuilder().SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

// Slows down password guessing and account creation attempts, on top of the per-account lockout.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddFixedWindowLimiter("auth", w => { w.PermitLimit = builder.Configuration.GetValue("Auth:RequestsPerMinute", 30); w.Window = TimeSpan.FromMinutes(1); w.QueueLimit = 0; });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    using var scope = app.Services.CreateScope();
    // Development convenience: bring the schema up to date on start. Elsewhere run `dotnet ef database update` as a deliberate step.
    scope.ServiceProvider.GetRequiredService<BirdEyeDbContext>().Database.Migrate();
}

// While there is no account yet, creating the first one needs a code that only appears here, in the server log.
using (var scope = app.Services.CreateScope())
{
    if (!await scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>().Users.AnyAsync())
        app.Logger.LogWarning("No account exists yet. Setup code for creating the first one: {SetupCode}", app.Services.GetRequiredService<SetupCode>().Generate());
}

app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (KeyNotFoundException e) { ctx.Response.StatusCode = 404; await ctx.Response.WriteAsJsonAsync(new { error = e.Message }); }
    catch (NotSupportedException e) { ctx.Response.StatusCode = 400; await ctx.Response.WriteAsJsonAsync(new { error = e.Message }); }
    catch (HttpRequestException e) { ctx.Response.StatusCode = 502; await ctx.Response.WriteAsJsonAsync(new { error = $"Upstream data source failed: {e.Message}" }); }
});

// Cross-site request forgery: a browser cannot add a custom header to a cross-site request without a CORS preflight, which is not granted,
// so requiring one on every state-changing call (on top of SameSite cookies) shuts that door.
app.Use(async (ctx, next) =>
{
    var unsafeMethod = HttpMethods.IsPost(ctx.Request.Method) || HttpMethods.IsPut(ctx.Request.Method) || HttpMethods.IsPatch(ctx.Request.Method) || HttpMethods.IsDelete(ctx.Request.Method);
    if (unsafeMethod && ctx.Request.Path.StartsWithSegments("/api") && string.IsNullOrEmpty(ctx.Request.Headers["X-Requested-With"]))
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsJsonAsync(new { error = "Missing the X-Requested-With header." });
        return;
    }
    await next();
});

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();

/// <summary>Exposed so the integration tests can start the whole application.</summary>
public partial class Program;

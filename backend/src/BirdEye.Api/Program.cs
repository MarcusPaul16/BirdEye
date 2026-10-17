using BirdEye.Infrastructure;
using BirdEye.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddOpenApi();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:4200").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    using var scope = app.Services.CreateScope();
    // Development convenience: bring the schema up to date on start. Elsewhere run `dotnet ef database update` as a deliberate step.
    scope.ServiceProvider.GetRequiredService<BirdEyeDbContext>().Database.Migrate();
}

app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (KeyNotFoundException e) { ctx.Response.StatusCode = 404; await ctx.Response.WriteAsJsonAsync(new { error = e.Message }); }
    catch (NotSupportedException e) { ctx.Response.StatusCode = 400; await ctx.Response.WriteAsJsonAsync(new { error = e.Message }); }
    catch (HttpRequestException e) { ctx.Response.StatusCode = 502; await ctx.Response.WriteAsJsonAsync(new { error = $"Upstream data source failed: {e.Message}" }); }
});

app.UseCors();
app.MapControllers();

app.Run();

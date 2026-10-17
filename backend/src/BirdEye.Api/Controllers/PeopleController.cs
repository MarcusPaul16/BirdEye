using BirdEye.Domain.Income;
using BirdEye.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BirdEye.Api.Controllers;

public record PersonRequest(string Name);

[ApiController]
[Route("api/people")]
public class PeopleController(BirdEyeDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IEnumerable<object>> List(CancellationToken ct) =>
        await db.People.OrderBy(p => p.Name).Select(p => new { p.Id, p.Name }).ToListAsync(ct);

    [HttpPost]
    public async Task<IActionResult> Create(PersonRequest req, CancellationToken ct)
    {
        var person = new Person { Name = req.Name };
        db.People.Add(person);
        await db.SaveChangesAsync(ct);
        return Created($"api/people/{person.Id}", new { person.Id, person.Name });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) =>
        await db.People.Where(p => p.Id == id).ExecuteDeleteAsync(ct) == 0 ? NotFound() : NoContent();
}

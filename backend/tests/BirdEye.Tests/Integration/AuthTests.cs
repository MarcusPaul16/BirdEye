using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace BirdEye.Tests.Integration;

public class AuthTests
{
    private static async Task<JsonElement> Json(HttpResponseMessage r) => (await r.Content.ReadFromJsonAsync<JsonElement>());

    [Theory]
    [InlineData("/api/people")]
    [InlineData("/api/income")]
    [InlineData("/api/income/summary")]
    [InlineData("/api/expenses")]
    [InlineData("/api/expenses/summary")]
    [InlineData("/api/portfolio/transactions")]
    [InlineData("/api/portfolio/positions")]
    [InlineData("/api/auth/me")]
    public async Task Data_endpoints_reject_anonymous_requests(string url)
    {
        using var app = new AppFactory();
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Browser().GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Status_is_public_and_says_the_first_account_needs_the_setup_code()
    {
        using var app = new AppFactory();
        var status = await Json(await app.Browser().GetAsync("/api/auth/status"));
        Assert.False(status.GetProperty("authenticated").GetBoolean());
        Assert.True(status.GetProperty("registrationOpen").GetBoolean());
        Assert.True(status.GetProperty("setupCodeRequired").GetBoolean());
    }

    [Fact]
    public async Task The_first_account_needs_the_right_setup_code()
    {
        using var app = new AppFactory();
        var browser = app.Browser();
        Assert.Equal(HttpStatusCode.Forbidden, (await app.Register(browser, "a@example.com", setupCode: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await app.Register(browser, "a@example.com", setupCode: "WRONG-CODE")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/auth/me")).StatusCode);

        var ok = await app.Register(browser, "a@example.com", setupCode: app.SetupCode.ToLowerInvariant().Replace("-", " "));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode); // case, dash and spaces do not matter when typing it
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task The_setup_code_is_spent_once_the_first_account_exists()
    {
        using var app = new AppFactory();
        await app.FirstUser();
        Assert.Throws<InvalidOperationException>(() => app.SetupCode);
        var status = await Json(await app.Browser().GetAsync("/api/auth/status"));
        Assert.False(status.GetProperty("setupCodeRequired").GetBoolean());
        Assert.False(status.GetProperty("registrationOpen").GetBoolean());
    }

    [Fact]
    public async Task Registration_is_closed_after_the_first_account_unless_it_is_switched_on()
    {
        using (var closed = new AppFactory(allowRegistration: false))
        {
            await closed.FirstUser();
            var second = await closed.Register(closed.Browser(), "second@example.com");
            Assert.Equal(HttpStatusCode.Forbidden, second.StatusCode);
        }
        using var open = new AppFactory(allowRegistration: true);
        await open.FirstUser();
        Assert.Equal(HttpStatusCode.OK, (await open.Register(open.Browser(), "second@example.com")).StatusCode);
    }

    [Fact]
    public async Task Two_simultaneous_first_registrations_produce_only_one_account()
    {
        using var app = new AppFactory();
        var code = app.SetupCode;
        var results = await Task.WhenAll(
            app.Register(app.Browser(), "one@example.com", setupCode: code),
            app.Register(app.Browser(), "two@example.com", setupCode: code));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.Forbidden);
    }

    [Theory]
    [InlineData("short")]
    [InlineData("123456789")]   // nine characters
    public async Task Passwords_shorter_than_ten_characters_are_refused(string password)
    {
        using var app = new AppFactory();
        var r = await app.Register(app.Browser(), "a@example.com", password, app.SetupCode);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("at least 10", (await Json(r)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_ten_character_password_is_enough_no_symbols_required()
    {
        using var app = new AppFactory();
        Assert.Equal(HttpStatusCode.OK, (await app.Register(app.Browser(), "a@example.com", "abcdefghij", app.SetupCode)).StatusCode);
    }

    [Theory]
    [InlineData("not-an-email")]
    [InlineData("")]
    [InlineData("a@")]
    public async Task Invalid_emails_are_refused(string email)
    {
        using var app = new AppFactory();
        Assert.Equal(HttpStatusCode.BadRequest, (await app.Register(app.Browser(), email, setupCode: app.SetupCode)).StatusCode);
    }

    [Fact]
    public async Task An_email_can_only_have_one_account_whatever_its_capitalisation()
    {
        using var app = new AppFactory(allowRegistration: true);
        await app.FirstUser("Paul@Example.com");
        var again = await app.Register(app.Browser(), "paul@example.COM");
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.Contains("already exists", (await Json(again)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Signing_in_works_and_signing_out_ends_the_session()
    {
        using var app = new AppFactory();
        await app.FirstUser("paul@example.com", "correct horse battery");

        var browser = app.Browser();
        var login = await browser.PostAsJsonAsync("/api/auth/login", new { email = "PAUL@example.com", password = "correct horse battery", rememberMe = true });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Equal("paul@example.com", (await Json(await browser.GetAsync("/api/auth/me"))).GetProperty("email").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await browser.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/people")).StatusCode);
    }

    [Fact]
    public async Task A_wrong_password_and_an_unknown_email_get_the_same_answer()
    {
        using var app = new AppFactory();
        await app.FirstUser("paul@example.com");
        var browser = app.Browser();
        var wrongPassword = await browser.PostAsJsonAsync("/api/auth/login", new { email = "paul@example.com", password = "not the password", rememberMe = false });
        var unknownEmail = await browser.PostAsJsonAsync("/api/auth/login", new { email = "nobody@example.com", password = "not the password", rememberMe = false });
        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);
        Assert.Equal(await wrongPassword.Content.ReadAsStringAsync(), await unknownEmail.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_fifth_wrong_password_locks_the_account_even_against_the_right_password()
    {
        using var app = new AppFactory();
        await app.FirstUser("paul@example.com", "correct horse battery");
        var browser = app.Browser();
        Task<HttpResponseMessage> Try(string password) => browser.PostAsJsonAsync("/api/auth/login", new { email = "paul@example.com", password, rememberMe = false });

        for (var i = 1; i <= 4; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await Try($"guess number {i}")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Try("guess number 5")).StatusCode);   // the lockout starts here

        var locked = await Try("correct horse battery");
        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        Assert.Contains("Too many failed attempts", (await Json(locked)).GetProperty("error").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task The_session_cookie_is_http_only_and_same_site_lax()
    {
        using var app = new AppFactory();
        var response = await app.Register(app.Browser(), "a@example.com", setupCode: app.SetupCode);
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("birdeye.auth="));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_signed_in_session_cannot_change_anything_without_the_custom_header()
    {
        using var app = new AppFactory();
        var browser = await app.FirstUser();   // signed in, header present

        // A request forged from another site carries the user's cookie but cannot add the header.
        browser.DefaultRequestHeaders.Remove("X-Requested-With");
        Assert.Equal(HttpStatusCode.BadRequest, (await browser.PostAsJsonAsync("/api/people", new { name = "Forged" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await browser.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/people")).StatusCode);   // reads are not state-changing
        Assert.Empty(await browser.GetFromJsonAsync<JsonElement[]>("/api/people") ?? []);        // and the forged write did not happen

        browser.DefaultRequestHeaders.Add("X-Requested-With", "test");
        Assert.Equal(HttpStatusCode.Created, (await browser.PostAsJsonAsync("/api/people", new { name = "Real" })).StatusCode);
    }

    [Fact]
    public async Task Changing_the_password_needs_the_current_one_and_keeps_the_session()
    {
        using var app = new AppFactory();
        var browser = await app.FirstUser("paul@example.com", "correct horse battery");

        Assert.Equal(HttpStatusCode.BadRequest, (await browser.PostAsJsonAsync("/api/auth/password", new { currentPassword = "wrong", newPassword = "another long password" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await browser.PostAsJsonAsync("/api/auth/password", new { currentPassword = "correct horse battery", newPassword = "short" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await browser.PostAsJsonAsync("/api/auth/password", new { currentPassword = "correct horse battery", newPassword = "another long password" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/auth/me")).StatusCode);

        var fresh = app.Browser();
        Assert.Equal(HttpStatusCode.Unauthorized, (await fresh.PostAsJsonAsync("/api/auth/login", new { email = "paul@example.com", password = "correct horse battery", rememberMe = false })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await fresh.PostAsJsonAsync("/api/auth/login", new { email = "paul@example.com", password = "another long password", rememberMe = false })).StatusCode);
    }
}

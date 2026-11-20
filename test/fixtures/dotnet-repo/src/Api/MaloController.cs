public class MaloController : ControllerBase
{
    [HttpGet("{id}")]
    public async Task<IActionResult> Ver(int id)
    {
        var e = _ctx.Items.Find(id);
        e.Visitas++;
        await _ctx.SaveChangesAsync();
        return Ok(e);
    }
}

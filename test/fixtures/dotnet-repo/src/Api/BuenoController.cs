public class BuenoController : ControllerBase
{
    [HttpGet("{id}")]
    public IActionResult Ver(int id) => Ok(_ctx.Items.Find(id));

    [HttpPost]
    public async Task<IActionResult> Registrar(Dto d)
    {
        _ctx.Items.Add(d.ToEntity());
        await _ctx.SaveChangesAsync();
        return Ok();
    }
}

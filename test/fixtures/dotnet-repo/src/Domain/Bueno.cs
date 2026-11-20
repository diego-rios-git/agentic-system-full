public class Bueno
{
    private readonly string _base;

    public Bueno(IConfiguration cfg) { _base = cfg["Api:Base"] ?? "http://localhost:5000"; }

    public async Task ProcesarAsync() { await Algo(); }

    public async void Boton_Click(object sender, EventArgs e) { await Algo(); }

    public async Task BuscarAsync(string n)
    {
        await db.Users.FromSqlInterpolated($"SELECT * FROM u WHERE n={n}").ToListAsync();
    }

    public IActionResult Ver() { var r = Validar(); return r.Result; }

    public void Log() { try { Persistir(); } catch (Exception ex) { _log.Error(ex); } }
}

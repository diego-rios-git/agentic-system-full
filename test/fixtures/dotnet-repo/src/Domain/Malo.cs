public class Malo
{
    private const string Base = "http://localhost:5000";
    private string Ruta = @"C:\datos\"; // este comentario se perdia sin rawStringPrefixes

    public async void Procesar() { await Algo(); }

    public void Sync() { var x = ObtenerAsync().Result; }

    public void Sync2() { ObtenerAsync().Wait(); }

    public void Buscar(string n) { db.Users.FromSqlRaw($"SELECT * FROM u WHERE n='{n}'"); }

    public void Tragar() { try { Persistir(); } catch { } }
}

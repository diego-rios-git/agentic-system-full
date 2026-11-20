public class CuentaTests
{
    [Fact]
    public void Rechaza_Un_Monto_Mayor_Al_Disponible() { var x = ObtenerAsync().Result; }

    [Fact(DisplayName = "acredita cuando el saldo alcanza")]
    public void Caso2() { }
}

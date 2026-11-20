export class MaloService {
  private base = "http://localhost:3000";

  async listar() {
    return this.repo.find({ where: { activo: true } });
  }

  async ver(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async filtrar(t: string) {
    const todos = await this.repo.find({ where: {} });
    return todos.filter((x) => x.tenantId === t);
  }

  async tragar() {
    try {
      await this.hacer();
    } catch (e) { }
  }
}

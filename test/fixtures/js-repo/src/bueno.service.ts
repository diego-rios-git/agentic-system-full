export class BuenoService {
  private base = process.env.API_URL ?? "http://localhost:3000";

  async listar(t: string) {
    return this.repo.find({ where: { activo: true, tenantId: t } });
  }

  async ver(id: string, t: string) {
    return this.repo.findOne({ where: { id, tenantId: t } });
  }

  async registrar() {
    try {
      await this.hacer();
    } catch (e) {
      this.logger.error(e);
    }
  }
}

// SQLite 后端的 Dexie 兼容层。
// 为什么做兼容层而不是重写调用点：现有 60+ 处调用只用到 Dexie 的一个很小子集
// （get/add/put/update/delete/bulk*/toArray/where().equals().{toArray,first,delete,sortBy}/orderBy().reverse()/filter()），
// 照着实现一遍，业务代码一行不用改，桌面化的风险就只剩这一个文件。
import { desktop } from "./bridge";

type Row = Record<string, any>;
const call = <T>(fn: string, ...args: unknown[]) => desktop().call<T>(fn, ...args);
const byField = <T extends Row>(rows: T[], f: string) => [...rows].sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0));

class Collection<T extends Row> {
  constructor(private load: () => Promise<T[]>, private del: () => Promise<number>) {}
  toArray() { return this.load(); }
  async first() { return (await this.load())[0]; }
  async sortBy(field: string) { return byField(await this.load(), field); }
  async count() { return (await this.load()).length; }
  delete() { return this.del(); }
  reverse() { const load = async () => (await this.load()).reverse(); return new Collection<T>(load, this.del); }
  filter(fn: (r: T) => boolean) { const load = async () => (await this.load()).filter(fn); return new Collection<T>(load, this.del); }
}

export class SqliteTable<T extends Row> {
  constructor(private table: string) {}
  toArray() { return call<T[]>("table.all", this.table); }
  get(id: string) { return call<T | undefined>("table.get", this.table, id); }
  async add(row: T) { await call("table.add", this.table, [row]); return (row as Row).id ?? (row as Row).key; }
  async put(row: T) { await call("table.put", this.table, [row]); return (row as Row).id ?? (row as Row).key; }
  async bulkAdd(rows: T[]) { if (rows.length) await call("table.add", this.table, rows); return rows.length; }
  async bulkPut(rows: T[]) { if (rows.length) await call("table.put", this.table, rows); return rows.length; }
  async bulkDelete(ids: string[]) { if (ids.length) await call("table.delete", this.table, ids); }
  async update(id: string, patch: Partial<T>) { return call<number>("table.update", this.table, id, patch); }
  async delete(id: string) { await call("table.delete", this.table, [id]); }
  where(field: string) {
    return {
      equals: (value: unknown) =>
        new Collection<T>(
          () => call<T[]>("table.byIndex", this.table, field, value),
          () => call<number>("table.deleteByIndex", this.table, field, value),
        ),
    };
  }
  orderBy(field: string) {
    return new Collection<T>(
      async () => byField(await this.toArray(), field),
      async () => { const all = await this.toArray(); await this.bulkDelete(all.map((r) => r.id)); return all.length; },
    );
  }
  filter(fn: (r: T) => boolean) {
    return new Collection<T>(
      async () => (await this.toArray()).filter(fn),
      async () => { const hit = (await this.toArray()).filter(fn); await this.bulkDelete(hit.map((r) => r.id)); return hit.length; },
    );
  }
}

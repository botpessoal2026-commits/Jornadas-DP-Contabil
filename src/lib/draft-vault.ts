import type { Schedule } from "./types";

export type DraftRecord = {
  key: string;
  owner: string;
  company: string;
  employee: string;
  month: string;
  savedAt: number;
  schedule: Schedule;
};
const expires = 7 * 24 * 60 * 60 * 1000;
export function draftKey(
  owner: string,
  company: string,
  employee: string,
  month: string,
) {
  return JSON.stringify([owner, company, employee, month.slice(0, 7)]);
}
export function validDraft(
  record: DraftRecord,
  owner: string,
  company: string,
  employee: string,
  month: string,
  now = Date.now(),
) {
  return (
    record.key === draftKey(owner, company, employee, month) &&
    record.owner === owner &&
    record.company === company &&
    record.employee === employee &&
    record.month === month.slice(0, 7) &&
    record.savedAt <= now &&
    now - record.savedAt < expires &&
    record.schedule.empresa_id === company &&
    record.schedule.funcionario_id === employee &&
    record.schedule.mes.slice(0, 7) === month.slice(0, 7)
  );
}
async function vault<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("cont-contabil-drafts", 1);
    open.onupgradeneeded = () =>
      open.result.createObjectStore("drafts", { keyPath: "key" });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction("drafts", mode);
      const request = action(tx.objectStore("drafts"));
      tx.oncomplete = () => {
        resolve(request.result);
        db.close();
      };
      tx.onerror = () => {
        reject(tx.error);
        db.close();
      };
      tx.onabort = () => {
        reject(tx.error);
        db.close();
      };
    };
  });
}
export async function readDraft(
  owner: string,
  company: string,
  employee: string,
  month: string,
) {
  const key = draftKey(owner, company, employee, month);
  const record = await vault<DraftRecord | undefined>("readonly", (s) =>
    s.get(key),
  );
  if (!record) return null;
  if (!validDraft(record, owner, company, employee, month)) {
    await deleteDraft(key);
    return null;
  }
  return record;
}
export async function writeDraft(owner: string, schedule: Schedule) {
  // No employee profile, CPF, legal documents or publication snapshots are cached.
  const minimal: Schedule = {
    id: schedule.id,
    empresa_id: schedule.empresa_id,
    funcionario_id: schedule.funcionario_id,
    modelo_id: schedule.modelo_id,
    mes: schedule.mes,
    dias: schedule.dias,
    modelo_tipo: schedule.modelo_tipo,
    modelo_nome: schedule.modelo_nome,
    nome_funcionario: schedule.nome_funcionario,
    revisao: schedule.revisao,
    status: schedule.status,
    updated_at: schedule.updated_at,
  };
  const record: DraftRecord = {
    key: draftKey(
      owner,
      schedule.empresa_id,
      schedule.funcionario_id,
      schedule.mes,
    ),
    owner,
    company: schedule.empresa_id,
    employee: schedule.funcionario_id,
    month: schedule.mes.slice(0, 7),
    savedAt: Date.now(),
    schedule: minimal,
  };
  await vault("readwrite", (s) => s.put(record));
}
export async function deleteDraft(key: string) {
  await vault("readwrite", (s) => s.delete(key));
}
export async function clearOwnerDrafts(owner: string) {
  const records = await vault<DraftRecord[]>("readonly", (s) => s.getAll());
  for (const record of records)
    if (record.owner === owner || Date.now() - record.savedAt >= expires)
      await deleteDraft(record.key);
}

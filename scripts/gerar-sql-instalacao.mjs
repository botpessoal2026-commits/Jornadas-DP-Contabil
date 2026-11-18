import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
const files = (await readdir("supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrations = await Promise.all(
  files.map(async (file) => ({
    file,
    sql: (await readFile(`supabase/migrations/${file}`, "utf8"))
      .replace(/^\s*begin\s*;/i, "")
      .replace(/\bcommit\s*;\s*$/i, ""),
  })),
);
const tables = [
  ...new Set(
    migrations.flatMap(({ sql }) =>
      [
        ...sql.matchAll(
          /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_]+)/gi,
        ),
      ].map((match) => match[1]),
    ),
  ),
];
const names = tables.map((name) => `'${name}'`).join(", ");
const header = `-- Gerado de migrations versionadas. SOMENTE PARA PROJETO NOVO.
-- Não apaga dados. Recusa banco com tabelas existentes do aplicativo.
-- Projeto existente: execute verificar-banco-existente.sql e não este arquivo.
-- Senhas e e-mails ficam exclusivamente em Supabase Auth; nome em user_metadata.
begin;
select pg_advisory_xact_lock(hashtext('cont_contabil_instalacao_inicial'));
do $instalacao_segura$
declare existentes text;
begin
 select string_agg(nome, ', ') into existentes from unnest(array[${names}]) nome where to_regclass('public.'||nome) is not null;
 if existentes is not null then
  raise exception 'Banco já contém tabelas do Gerador de Jornadas (%). Instalação interrompida sem alterar dados. Use verificar-banco-existente.sql e migrações incrementais.', existentes;
 end if;
end $instalacao_segura$;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
`;
let out = header;
for (const { file, sql } of migrations) {
  const version = file.split("_")[0],
    name = file.slice(version.length + 1, -4);
  out += `\n-- Migration: ${file}\n${sql}\ninsert into supabase_migrations.schema_migrations(version,name) values('${version}','${name}') on conflict(version) do nothing;\n`;
}
out += "\ncommit;\n";
await mkdir("supabase/setup", { recursive: true });
await writeFile("supabase/setup/instalacao-novo-projeto.sql", out);
const activationFiles = new Set([
  "202611180001_rest_rotation.sql",
  "202611180002_company_business_hours.sql",
  "202611180003_team_planning.sql",
]);
const incremental = migrations.filter(({ file }) => activationFiles.has(file));
await writeFile(
  "supabase/setup/ativar-planejamento-equipe.sql",
  `-- ATUALIZAÇÃO INCREMENTAL PARA O BANCO EXISTENTE.
-- Mantém registros, parâmetros legais e RLS. Novos horários continuam opcionais.
-- Reúne somente as migrations operacionais de revezamento, funcionamento e planejamento.
begin;
select pg_advisory_xact_lock(hashtext('cont_contabil_planejamento_equipe'));
do $base_existente$
declare nome text;
begin
 foreach nome in array array[${names}] loop
  if to_regclass('public.'||nome) is null then raise exception 'Tabela % ausente. Confira as migrations anteriores antes de ativar o planejamento.',nome; end if;
  if not(select relrowsecurity from pg_class where oid=to_regclass('public.'||nome)) then raise exception 'RLS desativada em %. Revise a configuração antes de continuar.',nome; end if;
 end loop;
end $base_existente$;
${incremental.map(({ file, sql }) => `\n-- Migration: ${file}\n${sql}`).join("\n")}
commit;
`,
);
await writeFile(
  "supabase/setup/verificar-banco-existente.sql",
  `-- Leitura apenas: não cria usuários, não muda registros nem permissões.
begin read only;
do $verificacao_segura$
declare nome text;
begin
 foreach nome in array array[${names}] loop
  if to_regclass('public.'||nome) is null then raise exception 'Tabela % ausente. Aplique somente as migrações pendentes do repositório.',nome; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||nome)) then raise exception 'RLS desativada na tabela %. Solicite revisão antes de usar o sistema.',nome; end if;
 end loop;
end $verificacao_segura$;
select tablename as tabela, rowsecurity as rls_habilitada
from pg_tables where schemaname='public' and tablename=any(array[${names}]) order by tablename;
commit;
`,
);
console.log(
  `SQL gerado: ${migrations.length} migrations; ${tables.length} tabelas com RLS.`,
);

# Modernização do Gerador — 29/10/2026

Base preservada: `034a2b8` (`codex/melhorias-revisao-gerador`). Trabalho na branch local `codex/modernizacao-gerador`. Esta etapa concentra P0 e P1 do prompt mestre, sem reescrever o sistema. Não houve push com autodeploy, publicação ou alteração de banco remoto.

## Entregue nesta etapa

- **P0 — Motor:** limites diários, semanais e contratuais em minutos efetivos de relógio; noturno computado separado. Regime comum não herda o teto do 12×36 e mantém proteção de 10h. Compensação exige modalidade, referência, comprovação, período e enquadramento pela data; cadastro da empresa não equivale a fundamento.
- **P0 — Repousos e transição:** repousos contínuos, sete dias consecutivos, contexto noturno e entre meses; limites de 44h/42h/40h e dois repousos pelas fases oficiais. Semana que atravessa vigência exige revisão, sem atribuir retroativamente o teto novo a todos os dias. Exceções dos arts. 8º/9º não são inferidas de permissões do cadastro.
- **P0 — Fontes:** Senado/Sigen e CLT na Câmara consultados; versão/data/escopo das sugestões identificados. Importação explícita, incremental e sem sobrescrita. Demonstração atual com 16/12/2026 e 16/12/2027. Consulte [ATUALIZACAO_LEGAL.md](ATUALIZACAO_LEGAL.md).
- **P0 — Conferência:** rotina central reutilizada por calendário, equipe, lote, operações, relatórios e aprovação; Bloqueante, Atenção e Informativo. Noturno isolado não é irregularidade. Fontes/condições pendentes impedem aprovação; atenção exige conferência e justificativa.
- **P0 — Banco:** migration incremental reforça as novas aprovações, incluindo RPC/UPDATE diretos, e preserva aprovações históricas. RLS/proprietário e revisão existentes mantidos. O banco valida atestação e fluxo; não reexecuta o motor TypeScript nem certifica enquadramento jurídico.
- **P0 — Duplicação:** ignora dias de contexto da competência anterior e mantém feriados e exceções do destino pelos fluxos existentes.
- **P1 — Simulador:** carga, dias, início e pausa; distribuição determinística de minutos residuais, meia-noite, comparação antes/depois e aplicação explícita em modelos reutilizáveis. Restrições matemáticas por dia, indisponibilidade e descanso disponíveis na API; a tela do modelo não deduz restrições individuais sem escolher o vínculo e a competência. O modelo pode então ser usado na geração individual ou em lote existente.
- **P1 — Interface:** navegação por áreas e menu recolhível; teclado/foco no menu móvel. Simulador integrado ao formulário existente. Temas, calendário individual, grade semanal, cobertura e demais módulos anteriores preservados. Logos locais configuráveis no build por `.env.example`, sem inventar imagens ou criar upload.
- **Relatórios existentes:** PDF e Excel usam a conferência central e mostram a classificação; horas de relógio e computadas continuam discriminadas. Folha de ponto individual A4 e campos reais em branco preservados, sem AFD/AEJ ou ponto fictício.

## Arquivos principais

- Motor e domínio: `src/lib/engine.ts`, `legal-reference.ts`, `validation.ts`, `validation-policy.ts`, `alerts.ts`, `work-regime.ts`, `schedule-governance.ts`, `schedule-simulator.ts`.
- Integração: `store.ts`, `presets.ts`, `demo.ts`, `exports.ts`, `company-context.ts`, `company-operations.ts`, `schedule-bulk.ts`, `team-schedule.ts`, `work-queue.ts`, `types.ts`.
- Interface: `workspace.tsx`, `workspace-sidebar.tsx`, `schedule-simulator.tsx`, `model-fields.tsx`, `legal-fields.tsx`, `schedule-alerts.tsx`, `schedule-governance.tsx`, `employee-admin.tsx`, `brand.tsx`, `brand-assets.ts`, `globals.css`, `modernization.css`.
- Testes: novos `engine-modernization.test.ts`, `legal-reference.test.ts`, `validation-policy.test.ts`, `schedule-simulator.test.ts`, `e2e/modernization.spec.ts`; regressões e fixtures anteriores ajustadas às mudanças efetivas de datas, base horária e rótulos.

## Migration e implantação futura

Nova: `supabase/migrations/20261029123937_three_level_review_attestation.sql`. Requer a sequência de migrations anteriores. Apenas testes locais em PGlite; não aplicada remotamente. Advisor local não disponível porque não há Postgres/Supabase local em `54322`; não foi declarado aprovado.

Para implantação futura: revisar o diff, aplicar a sequência em ambiente de teste, homologar Auth/RLS e gravação/recarga com contas autorizadas, gerar um Preview e validar fluxos. A implantação desta etapa e qualquer mudança em banco remoto precisam de autorização; produção permanece preservada. A demonstração é fictícia e não representa persistência real.

## Validação

Baseline: 256/256 testes. Após implementação: **297/297 testes unitários/SQL aprovados**. Build de produção, TypeScript, Prettier e diff-check aprovados. `npm audit --omit=dev`: zero vulnerabilidades reportadas. **78 cenários de navegador validados**: suíte completa com 74 aprovações e quatro falhas de seletores/expectativas antigas; após atualizar títulos, contexto da empresa e noturno informativo, a reexecução final dos 14 cenários afetados passou integralmente. As falhas intermediárias não foram omitidas nem corrigidas desativando validações. A execução afetada intermediária teve 13/14 antes de atualizar a expectativa de noturno, agora informativo.

Sete capturas em desktop (1440px) e celular (375px), nos temas claro e escuro: nenhum erro JavaScript, chamada ao Supabase no modo demo ou transbordamento horizontal nas telas inspecionadas. Ações dos modais visíveis; Escape no menu móvel restaura o foco. Exportações reais PDF/XLSX/CSV/ZIP e folha A4 continuam cobertas pelos cenários anteriores. Auth e persistência remotos não foram homologados com contas reais.

```sh
npm ci
# Configure .env.local a partir de .env.example para usar Auth/persistência reais.
npm run dev
# A demonstração está em http://localhost:3000/?demo=1
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run format:check
npm audit --omit=dev
```

Playwright usa Chromium do sistema, quando disponível; caso necessário: `npx playwright install chromium`. Não execute `next dev` ao mesmo tempo que os testes do build de produção na porta 3000.

## Pendências do prompt mestre

- **P1 completo:** gerador com restrições individuais selecionadas na própria tela, comparação de escalas de competências anteriores lado a lado e sugestão automática geral de folgas/cobertura. O simulador entregue resolve a distribuição matemática e se conecta ao fluxo de modelos/lote, sem anunciar um otimizador geral.
- **P2:** relatórios PDF dedicados ao quadro geral/equipe, comparativo de jornadas e conferência independente; expansão dos painéis e formatos Excel; copiar/colar entre funcionários, arquivamento de modelos, catálogo próprio de departamentos/funções e planejamento detalhado de compensações. Recursos anteriores de importação, versões, lote, cobertura e operações permanecem disponíveis.
- **P3:** colaboradores, convites, papéis por empresa, portal do cliente, anexos privados, integrações oficiais e autorização compartilhada no servidor/banco. Não foram acrescentados controles de aparência sem autorização efetiva.
- Homologação remota com usuários reais e migrações; exceções legais específicas por categoria exigem enquadramento e implementação/validação própria. A fonte oficial não prova a aplicação de um acordo ao funcionário.

O cadastro de registros realizados continua independente do planejamento e não cria marcações automáticas. A ferramenta não apura remuneração ou banco real, nem substitui um registrador eletrônico de ponto.

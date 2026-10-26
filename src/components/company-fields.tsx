import type { Company, Model } from "@/lib/types";
import { modelsForCompany } from "@/lib/company-resources";

export default function CompanyFields({
  company,
  models,
}: {
  company?: Company;
  models: Model[];
}) {
  const available = company
    ? modelsForCompany(models, company.id, [company.modelo_padrao_id])
    : [];
  return (
    <>
      <p className="span2 muted">
        Informe a identificação agora e complete o restante depois. Somente o
        nome é obrigatório.
      </p>
      <label>
        Nome da empresa / razão social
        <input
          name="nome"
          required
          maxLength={160}
          defaultValue={company?.nome ?? ""}
        />
      </label>
      <label>
        Nome fantasia
        <input
          name="nome_fantasia"
          maxLength={160}
          defaultValue={company?.nome_fantasia ?? ""}
        />
      </label>
      <label>
        CNPJ
        <input
          name="cnpj"
          inputMode="numeric"
          maxLength={18}
          placeholder="Opcional: 00.000.000/0000-00"
          defaultValue={company?.cnpj ?? ""}
        />
      </label>
      <label>
        Código interno
        <input
          name="codigo_interno"
          maxLength={80}
          defaultValue={company?.codigo_interno ?? ""}
        />
      </label>
      <label>
        Situação cadastral
        <input
          type="hidden"
          name="situacao"
          value={company?.situacao ?? "ativa"}
        />
        <select disabled defaultValue={company?.situacao ?? "ativa"}>
          <option value="ativa">Ativa</option>
          <option value="inativa">Inativa</option>
          <option value="arquivada">Arquivada</option>
        </select>
      </label>
      <p className="warning-text self-end">
        Para inativar, arquivar ou reativar, use as ações em Configurações da
        empresa. Essas ações preservam o histórico e pedem confirmação
        explícita.
      </p>
      <label>
        Cidade
        <input
          name="cidade"
          maxLength={100}
          defaultValue={company?.cidade ?? ""}
        />
      </label>
      <label>
        UF
        <input
          name="uf"
          pattern="[A-Za-z]{2}"
          maxLength={2}
          placeholder="Ex.: PE"
          defaultValue={company?.uf ?? ""}
        />
      </label>
      <label className="span2">
        Endereço
        <input
          name="endereco"
          maxLength={250}
          defaultValue={company?.endereco ?? ""}
        />
      </label>
      <label>
        CEP
        <input
          name="cep"
          inputMode="numeric"
          pattern="[0-9]{5}-?[0-9]{3}"
          maxLength={9}
          placeholder="00000-000"
          defaultValue={company?.cep ?? ""}
        />
      </label>
      <label>
        Responsável pelo cadastro
        <input
          name="responsavel"
          maxLength={160}
          defaultValue={company?.responsavel ?? ""}
        />
      </label>
      <label className="span2">
        Contato da empresa
        <input
          name="contato"
          maxLength={200}
          placeholder="E-mail ou telefone, se necessário"
          defaultValue={company?.contato ?? ""}
        />
      </label>
      <label>
        Modelo padrão da empresa
        <select
          name="modelo_padrao_id"
          defaultValue={company?.modelo_padrao_id ?? ""}
        >
          <option value="">Sem modelo padrão definido</option>
          {available.map((model) => (
            <option key={model.id} value={model.id}>
              {model.nome}
              {model.empresa_id ? "" : " · biblioteca vinculada (legado)"}
            </option>
          ))}
        </select>
      </label>
      <p className="span2 muted">
        Para usar um modelo-base, copie-o em Jornadas e modelos desta empresa. A
        cópia poderá ser personalizada sem alterar a biblioteca ou outras
        empresas.
      </p>
      <label>
        Carga semanal padrão (horas)
        <input
          name="carga_semanal_padrao"
          type="number"
          min={1 / 60}
          max="168"
          step="any"
          placeholder="Ex.: 30 ou 30,5"
          defaultValue={
            company?.carga_semanal_padrao_minutos
              ? company.carga_semanal_padrao_minutos / 60
              : ""
          }
        />
      </label>
      <p className="span2 warning-text">
        O padrão é uma configuração inicial. Alterá-lo não reescreve contratos,
        jornadas individuais ou escalas existentes. A carga precisa respeitar o
        instrumento aplicável.
      </p>
      <label className="span2">
        CCT aplicável e fundamento das permissões
        <textarea
          name="cct"
          placeholder="Informe sindicato, convenção e cláusulas aplicáveis, após conferência."
          defaultValue={company?.cct ?? ""}
        />
      </label>
      <label>
        Limite diário permitido (horas decimais, opcional)
        <input
          name="limite"
          type="number"
          min="0.01"
          max="24"
          step="0.01"
          placeholder="Ex.: 8,4 para 8h24"
          defaultValue={
            company?.limite_diario_minutos
              ? company.limite_diario_minutos / 60
              : ""
          }
        />
      </label>
      <p className="warning-text self-end">
        Em branco: segue o parâmetro legal vigente. Um limite específico exige
        conferência da CCT.
      </p>
      <label className="check-label">
        <input
          name="permite_6x1"
          type="checkbox"
          defaultChecked={company?.permite_6x1 ?? false}
        />
        Permite escala 6×1 pela CCT
      </label>
      <label className="check-label">
        <input
          name="banco"
          type="checkbox"
          defaultChecked={company?.usa_banco_horas ?? false}
        />
        Usa banco de horas
      </label>
      <label className="check-label">
        <input
          name="folgar_feriados"
          type="checkbox"
          defaultChecked={company?.folgar_feriados ?? true}
        />
        Folgar nos feriados ao gerar escalas
      </label>
      <label className="span2">
        Política de funcionamento em domingos e feriados
        <textarea
          name="politica_domingo_feriado"
          defaultValue={company?.politica_domingo_feriado ?? ""}
          placeholder="Observação operacional; não elimina a aplicação legal de feriados."
        />
      </label>
      <label className="span2">
        Observações internas
        <textarea
          name="observacoes"
          defaultValue={company?.observacoes ?? ""}
        />
      </label>
    </>
  );
}

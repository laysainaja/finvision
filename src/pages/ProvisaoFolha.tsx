import { useState } from 'react';
import { api, qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR, hoje } from '../lib/format';
import { exportarCSV } from '../lib/exportar';
import type { Contato } from '../types';
import { Field, Icon, Modal, useAcao } from '../components/ui';
import { TopoRelatorio } from '../components/LogoEmpresa';

type Vinculo = 'clt' | 'estagio' | 'pj' | 'socio';
const NOME_VINCULO: Record<Vinculo, string> = { clt: 'CLT', estagio: 'Estágio', pj: 'PJ / autônomo', socio: 'Sócio (pró-labore)' };

interface Colaborador {
  id: number; nome: string; vinculo: Vinculo; contato_id: number | null; contato_nome: string | null; salario_base: number | null;
  admissao: string | null; demissao: string | null; ferias_desde: string | null; observacao: string | null;
}
interface Valores { decimo: number; ferias: number; terco: number; recesso: number; fgts: number; multa: number; total: number }
interface LinhaProvisao {
  id: number; nome: string; vinculo: Vinculo; admissao: string | null; ferias_desde: string | null; salario_base: number | null;
  media: number | null; meses_media: number; base: number; base_origem: 'media' | 'salario' | null;
  mensal: Valores; acumulado: Valores & { meses_decimo: number; meses_ferias: number; ferias_vencidas: boolean };
}
interface RelProvisao { ref: string; multa: boolean; colaboradores: LinhaProvisao[]; totais: { mensal: number; decimo: number; ferias: number; recesso: number; fgts: number; acumulado: number } }

/** Provisão de folha: quanto separar por mês para 13º, férias + 1/3 e FGTS, e o que já está acumulado. */
export function ProvisaoFolha() {
  const { base, versao, empresa } = useEmpresa();
  const [ref, setRef] = useState(hoje());
  const [multa, setMulta] = useState(false);
  const [editar, setEditar] = useState<Colaborador | 'novo' | null>(null);
  const cadastro = useApi<Colaborador[]>(`${base}/colaboradores?v=${versao}`);
  const { data, erro, recarregar } = useApi<RelProvisao>(`${base}/relatorios/provisao-folha${qs({ ref, multa: multa ? 1 : null, v: versao })}`);
  const comProvisao = data?.colaboradores.filter((c) => c.mensal.total > 0) ?? [];
  const semProvisao = data?.colaboradores.filter((c) => c.mensal.total === 0) ?? [];
  const salvo = () => (setEditar(null), cadastro.recarregar(), recarregar());

  const exportar = () => data && exportarCSV(`Provisão de folha ${empresa?.nome} ${data.ref}`,
    ['Colaborador', 'Vínculo', 'Base', '13º/mês', 'Férias/mês', '1/3/mês', 'Recesso/mês', 'FGTS/mês', 'Multa FGTS/mês', 'Total/mês', '13º acumulado', 'Férias + 1/3 acumuladas', 'Recesso acumulado', 'FGTS acumulado', 'Total acumulado'],
    data.colaboradores.map((c) => [c.nome, NOME_VINCULO[c.vinculo], c.base, c.mensal.decimo, c.mensal.ferias, c.mensal.terco, c.mensal.recesso, c.mensal.fgts, c.mensal.multa, c.mensal.total,
      c.acumulado.decimo, c.acumulado.ferias + c.acumulado.terco, c.acumulado.recesso, c.acumulado.fgts + c.acumulado.multa, c.acumulado.total]),
    [`Provisão de folha · ${empresa?.nome ?? ''}`, `Referência: ${dataBR(data.ref)}${data.multa ? ' · com multa de 40% do FGTS' : ''}`]);

  return (
    <>
      <TopoRelatorio titulo="Provisão de folha" descricao="Quanto separar todo mês para 13º, férias + 1/3 e o FGTS sobre eles, e quanto já está acumulado por colaborador." />
      <div className="card">
        <div className="toolbar">
          <Field label="Posição em">
            <input className="input" type="date" value={ref} onChange={(e) => e.target.value && setRef(e.target.value)} />
          </Field>
          <label className="check"><input type="checkbox" checked={multa} onChange={(e) => setMulta(e.target.checked)} /> Incluir multa de 40% do FGTS (rescisão)</label>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setEditar('novo')}><Icon name="mais" /> Colaborador</button>
          <button className="btn" onClick={exportar} disabled={!data}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && (
          <div className="cartoes-extrato rel-cartoes ltv-cartoes">
            <div className="cartao-extrato total"><span className="kpi-label">Separar por mês (R$)</span><span className="cartao-valor num">{brl(data.totais.mensal)}</span><span className="small muted">{comProvisao.length} colaborador(es) com provisão</span></div>
            <div className="cartao-extrato"><span className="kpi-label">13º acumulado (R$)</span><span className="cartao-valor num">{brl(data.totais.decimo)}</span><span className="small muted">no ano, até {dataBR(data.ref)}</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Férias + 1/3 e recesso (R$)</span><span className="cartao-valor num">{brl(data.totais.ferias + data.totais.recesso)}</span><span className="small muted">períodos em aberto</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Total já devido (R$)</span><span className="cartao-valor num alerta">{brl(data.totais.acumulado)}</span><span className="small muted">com FGTS{data.multa ? ' e multa' : ''}</span></div>
          </div>
        )}
        {data && comProvisao.length > 0 && (
          <div className="table-wrap">
            <table className="tabela-relatorio">
              <thead>
                <tr>
                  <th className="col-fixa">Colaborador</th><th className="r">Base</th>
                  <th className="r">13º</th><th className="r">Férias</th><th className="r">1/3</th><th className="r">Recesso</th><th className="r">FGTS{data.multa ? ' + multa' : ''}</th>
                  <th className="r">Por mês</th><th className="r">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {comProvisao.map((c) => (
                  <tr key={c.id}>
                    <td className="col-fixa">
                      <button className="link-botao" onClick={() => setEditar(cadastro.data?.find((x) => x.id === c.id) ?? null)}>{c.nome}</button>
                      <div className="desc-sub">
                        {NOME_VINCULO[c.vinculo]} · desde {c.admissao ? dataBR(c.admissao) : '—'}
                        {c.acumulado.ferias_vencidas && <span className="alerta"> · {c.vinculo === 'clt' ? 'férias' : 'recesso'} vencido(as): {c.acumulado.meses_ferias} meses sem tirar</span>}
                      </div>
                    </td>
                    <td className="r num" title={c.base_origem === 'media' ? `Média de ${c.meses_media} mês(es) pagos (salário + comissões)` : 'Salário base informado'}>
                      {brl(c.base)}<div className="desc-sub">{c.base_origem === 'media' ? `média de ${c.meses_media} mês(es)` : c.base_origem === 'salario' ? 'salário informado' : 'sem valor'}</div>
                    </td>
                    <td className="r num">{brl(c.mensal.decimo)}<div className="desc-sub">{brl(c.acumulado.decimo)} ({c.acumulado.meses_decimo}/12)</div></td>
                    <td className="r num">{brl(c.mensal.ferias)}<div className="desc-sub">{brl(c.acumulado.ferias)} ({c.acumulado.meses_ferias}/12)</div></td>
                    <td className="r num">{brl(c.mensal.terco)}<div className="desc-sub">{brl(c.acumulado.terco)}</div></td>
                    <td className="r num">{brl(c.mensal.recesso)}<div className="desc-sub">{brl(c.acumulado.recesso)}{c.vinculo === 'estagio' ? ` (${c.acumulado.meses_ferias}/12)` : ''}</div></td>
                    <td className="r num">{brl(c.mensal.fgts + c.mensal.multa)}<div className="desc-sub">{brl(c.acumulado.fgts + c.acumulado.multa)}</div></td>
                    <td className="r num"><b>{brl(c.mensal.total)}</b></td>
                    <td className="r num"><b>{brl(c.acumulado.total)}</b></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td className="col-fixa" colSpan={7}>Total</td><td className="r num">{brl(data.totais.mensal)}</td><td className="r num">{brl(data.totais.acumulado)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
        {data && !data.colaboradores.length && <div className="vazio">Nenhum colaborador cadastrado. Clique em "Colaborador" para começar pelos CLT e estagiários.</div>}
        {semProvisao.length > 0 && (
          <div className="card-pad small muted">
            Sem provisão: {semProvisao.map((c, i) => (
              <span key={c.id}>{i > 0 && ', '}<button className="link-botao" onClick={() => setEditar(cadastro.data?.find((x) => x.id === c.id) ?? null)}>{c.nome}</button> ({NOME_VINCULO[c.vinculo]})</span>
            ))}
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        CLT: 13º = base ÷ 12, férias = base ÷ 12, 1/3 de férias = base ÷ 36, FGTS = 8% sobre os três. Estágio: só o recesso remunerado (30 dias por ano) = base ÷ 12.
        PJ e sócios não geram provisão. A base é a média do que foi pago à pessoa nos últimos 12 meses (salário + comissões), pelo cadastro ligado; sem pagamentos, vale o salário informado.
        Conta o mês em que a pessoa trabalhou 15 dias ou mais. O INSS patronal não entra (no Simples, anexos III e V, já está no DAS). O valor de cada linha pequena é o acumulado até a data escolhida.
      </p>
      {editar && <FormColaborador colaborador={editar === 'novo' ? undefined : editar} onClose={() => setEditar(null)} onSalvo={salvo} />}
    </>
  );
}

function FormColaborador({ colaborador, onClose, onSalvo }: { colaborador?: Colaborador; onClose: () => void; onSalvo: () => void }) {
  const { base } = useEmpresa();
  const acao = useAcao();
  const contatos = useApi<Contato[]>(`${base}/contatos?tipo=fornecedor`);
  const [f, setF] = useState({
    nome: colaborador?.nome ?? '', vinculo: colaborador?.vinculo ?? ('clt' as Vinculo), contato_id: colaborador?.contato_id ?? ('' as number | ''),
    salario: colaborador?.salario_base != null ? (colaborador.salario_base / 100).toFixed(2).replace('.', ',') : '',
    admissao: colaborador?.admissao ?? '', demissao: colaborador?.demissao ?? '', ferias_desde: colaborador?.ferias_desde ?? '', observacao: colaborador?.observacao ?? '',
  });
  const centavos = (s: string) => (s.trim() ? Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100) : null);
  const salvar = async () => {
    const corpo = { ...f, contato_id: f.contato_id || null, salario_base: centavos(f.salario), admissao: f.admissao || null, demissao: f.demissao || null, ferias_desde: f.ferias_desde || null };
    const ok = await acao(() => (colaborador ? api.put(`${base}/colaboradores/${colaborador.id}`, corpo) : api.post(`${base}/colaboradores`, corpo)), colaborador ? 'Colaborador atualizado.' : 'Colaborador cadastrado.');
    if (ok) onSalvo();
  };
  const excluir = async () => {
    if (!colaborador || !confirm(`Excluir ${colaborador.nome} do cadastro de colaboradores? Os lançamentos não mudam.`)) return;
    if (await acao(() => api.del(`${base}/colaboradores/${colaborador.id}`), 'Colaborador excluído.')) onSalvo();
  };
  return (
    <Modal titulo={colaborador ? 'Editar colaborador' : 'Novo colaborador'} onClose={onClose}
      rodape={<>
        {colaborador && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={excluir}>Excluir</button>}
        <button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={salvar}>Salvar</button>
      </>}>
      <div className="form-grid">
        <Field label="Nome" className="full"><input className="input" autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
        <Field label="Vínculo">
          <select className="select input" value={f.vinculo} onChange={(e) => setF({ ...f, vinculo: e.target.value as Vinculo })}>
            {(Object.keys(NOME_VINCULO) as Vinculo[]).map((v) => <option key={v} value={v}>{NOME_VINCULO[v]}</option>)}
          </select>
        </Field>
        <Field label="Cadastro nos pagamentos">
          <select className="select input" value={f.contato_id} onChange={(e) => setF({ ...f, contato_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">—</option>
            {contatos.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Field>
        <Field label="Salário base (R$)"><input className="input" inputMode="decimal" value={f.salario} onChange={(e) => setF({ ...f, salario: e.target.value })} placeholder="Usado se não houver pagamentos" /></Field>
        <Field label="Admissão"><input className="input" type="date" value={f.admissao} onChange={(e) => setF({ ...f, admissao: e.target.value })} /></Field>
        <Field label="Férias a vencer desde"><input className="input" type="date" value={f.ferias_desde} onChange={(e) => setF({ ...f, ferias_desde: e.target.value })} /></Field>
        <Field label="Desligamento"><input className="input" type="date" value={f.demissao} onChange={(e) => setF({ ...f, demissao: e.target.value })} /></Field>
        <Field label="Observação" className="full"><input className="input" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} /></Field>
      </div>
      <p className="muted small">
        Ligando ao cadastro dos pagamentos, a base vira a média do que foi pago à pessoa (salário + comissões) nos últimos 12 meses.
        "Férias a vencer desde": início do período em aberto (depois das últimas férias); vazio = desde a admissão.
      </p>
    </Modal>
  );
}

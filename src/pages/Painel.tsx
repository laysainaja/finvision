import { useState } from 'react';
import { qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { addMeses, brl, dataBR, fimMes, inicioMes } from '../lib/format';
import type { Fluxo, Lancamento, Resumo, ResumoTipo } from '../types';
import { Icon, StatusBadge } from '../components/ui';
import { FluxoChart, LegendaFluxo } from '../components/FluxoChart';
import { BaixaModal, NOME_TIPO } from '../components/LancamentoForms';

function CardTipo({ titulo, r, href }: { titulo: string; r: ResumoTipo; href: string }) {
  return (
    <a className="card kpi" href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
      <div className="kpi-label">{titulo}</div>
      <div className="kpi-valor">{brl(r.mes + r.vencido)}</div>
      <div className="kpi-sub">
        <span>
          Vencido <b className={'num ' + (r.vencido ? 'alerta' : '')}>{brl(r.vencido)}</b>
        </span>
        <span>Vence hoje <b className="num">{brl(r.hoje)}</b></span>
        <span>Próximos 7 dias <b className="num">{brl(r.semana)}</b></span>
      </div>
    </a>
  );
}

export function Painel() {
  const { base, versao, recarregar } = useEmpresa();
  const { data: r } = useApi<Resumo>(`${base}/resumo?v=${versao}`);
  const [baixa, setBaixa] = useState<Lancamento | null>(null);
  const hoje = r?.hoje;
  const { data: f } = useApi<Fluxo>(
    hoje ? `${base}/fluxo-caixa${qs({ de: inicioMes(addMeses(hoje, -3)), ate: fimMes(addMeses(hoje, 3)), agrupar: 'mes', v: versao })}` : null,
  );
  if (!r) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Painel</h1>
          <p>Visão geral de hoje, {dataBR(r.hoje)}.</p>
        </div>
      </div>

      <div className="grid grid-4">
        <a className="card kpi" href="#/cadastros" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="kpi-label">Saldo em contas</div>
          <div className={'kpi-valor ' + (r.saldo_total < 0 ? 'alerta' : '')}>{brl(r.saldo_total)}</div>
          <div className="kpi-sub">
            {/* Só as contas com dinheiro; as zeradas continuam em Configurações. */}
            {r.contas.filter((c) => c.ativa && c.saldo_atual !== 0).map((c) => (
              <span key={c.id}>
                {c.nome} <b className="num">{brl(c.saldo_atual)}</b>
              </span>
            ))}
          </div>
        </a>
        <CardTipo titulo="A receber até o fim do mês" r={r.receber} href="#/receber" />
        <CardTipo titulo="A pagar até o fim do mês" r={r.pagar} href="#/pagar" />
        <a className="card kpi" href="#/conciliacao" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="kpi-label">Conciliação bancária</div>
          <div className="kpi-valor">{r.pendentes_conciliacao}</div>
          <div className="kpi-sub">
            {r.pendentes_conciliacao ? 'movimentos do extrato aguardando conferência' : 'Tudo conferido. Importe um novo extrato.'}
          </div>
        </a>
      </div>

      <div className="grid grid-main">
        <div className="card">
          <div className="card-header">
            <h2>Fluxo de caixa · 3 meses antes e depois</h2>
            <a href="#/fluxo" className="btn btn-sm btn-ghost">Ver completo</a>
          </div>
          <div className="card-pad">
            <LegendaFluxo />
            {f && <FluxoChart periodos={f.periodos} agrupar="mes" hoje={f.hoje} />}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Vencidos e próximos 7 dias</h2>
          </div>
          {r.proximos.length === 0 && <div className="vazio">Nada vencendo nos próximos dias. 🎉</div>}
          {r.proximos.map((l) => (
            <div key={l.id} className="conta-linha" style={{ gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="desc-principal" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={l.tipo === 'pagar' ? 'saida' : 'entrada'} title={l.tipo === 'pagar' ? 'A pagar' : 'A receber'}>
                    <Icon name={l.tipo} size={14} />
                  </span>
                  {l.descricao}
                </div>
                <div className="desc-sub">
                  {dataBR(l.vencimento)} · {l.contato ?? '—'} <StatusBadge status={l.status} />
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num desc-principal">{brl(l.valor)}</div>
                <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => setBaixa(l)}>
                  {NOME_TIPO[l.tipo].acao}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {baixa && (
        <BaixaModal
          lancamentos={[baixa]}
          onClose={() => setBaixa(null)}
          onSaved={() => {
            setBaixa(null);
            recarregar();
          }}
        />
      )}
    </>
  );
}

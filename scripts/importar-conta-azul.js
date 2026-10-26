// Importa o "Extrato financeiro" exportado do Conta Azul para uma empresa do FinVision.
// A planilha precisa antes virar JSON (uma linha por objeto, com os títulos das colunas do Conta Azul).
// Sem --gravar só mostra a prévia (nada é gravado). Os lançamentos ficam marcados com MARCA na observação.
// --refazer apaga a importação anterior (só os lançamentos com MARCA) e importa de novo; o que foi lançado à mão fica.
// Uso: node --env-file=.env scripts/importar-conta-azul.js extrato.json --cnpj 41735336000180 [--saldo "C6 - 41735336000180=2668.03"] [--refazer] [--gravar]
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sql, get, all, transaction } from '../server/db.js';
import { chaveNome } from '../server/util.js';
import { resolverContato } from '../server/contatos.js';
import { vincularTransferencias } from '../server/api.js';

const MARCA = 'Importado do Conta Azul';
const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const arquivo = args[0];
const cnpj = (opcao('--cnpj') ?? '').replace(/\D/g, '');
const gravar = args.includes('--gravar');
const refazer = args.includes('--refazer');
if (!arquivo || !cnpj) {
  console.error('Uso: node --env-file=.env scripts/importar-conta-azul.js extrato.json --cnpj 00000000000000 [--saldo "Conta=1234.56"] [--refazer] [--gravar]');
  process.exit(1);
}

// ---------- Categorias do Conta Azul → FinVision ----------
// A categoria mantém o nome do Conta Azul (usa a existente pelo nome, ignorando maiúsculas e acentos; senão cria).
// DESTINO só define a linha da DRE e o grupo do Forecast de cada uma (o primeiro item é o nome antigo, só para referência).
const FORA = 'fora_resultado';
const DESTINO = {
  receita: {
    'Receitas de Serviços': ['Prestação de serviços', 'receita_bruta'],
    'Receitas de Vendas': ['Prestação de serviços', 'receita_bruta'],
    'Antecipação receita': ['Prestação de serviços', 'receita_bruta'],
    'Receitas a Identificar': ['Receitas a identificar', 'outra_receita'],
    'Devolução receitas': ['Outras receitas', 'outra_receita'],
    'Empréstimos de Sócios': ['Empréstimos e aportes de sócios', FORA],
    'Transferência de Entrada': ['Transferência entre contas (entrada)', FORA],
    'Antecipação': ['Antecipação Asaas (cobrança recebida)', FORA],
  },
  despesa: {
    'Remuneração de Autônomos': ['Remuneração de autônomo (colaborador)', 'custo', 'fixo'],
    'Remuneração de Estagiários': ['Remuneração de estagiários', 'despesa_operacional', 'fixo'],
    'Plataforma': ['Plataformas', 'despesa_operacional', 'fixo'],
    'Software / Licença de Uso': ['Software e serviços', 'despesa_operacional', 'fixo'],
    'Marketing e Publicidade': ['Investimento em anúncios', 'despesa_operacional', 'investimento'],
    'Comissões de Vendedores': ['Comissão', 'custo', 'variavel'],
    'Simples Nacional - DAS': ['Impostos', 'deducao', 'variavel'],
    'Parcelamento do Simples Nacional': ['Simples atrasado', 'deducao', 'fixo'],
    'Tarifas de Boletos': ['Tarifas bancárias', 'despesa_financeira', 'variavel'],
    'Tarifas de Cartões de Crédito': ['Tarifas bancárias', 'despesa_financeira', 'variavel'],
    'Tarifas Bancárias': ['Tarifas bancárias', 'despesa_financeira', 'variavel'],
    'Tarifas DOC / TED': ['Tarifas bancárias', 'despesa_financeira', 'variavel'],
    'Honorários Contábeis': ['Honorários contábeis', 'despesa_operacional', 'fixo'],
    'Honorários Advocatícios': ['Honorários advocatícios', 'despesa_operacional', 'fixo'],
    'Materiais Aplicados na Prestação de Serviços': ['Materiais aplicados na prestação de serviço', 'custo', 'variavel'],
    'Plano de Saúde Sócios': ['Plano de saúde', 'despesa_operacional', 'fixo'],
    'Água e Saneamento': ['Água e saneamento', 'despesa_operacional', 'fixo'],
    'Combustíveis': ['Combustíveis', 'despesa_operacional', 'fixo'],
    'Antecipação despesas': ['Tarifas bancárias', 'despesa_financeira', 'variavel'],
    'Pró-labore': ['Pró-labore', 'despesa_operacional', 'fixo'],
    'Salários': ['Salários', 'despesa_operacional', 'fixo'],
    'PLR - Participação nos Lucros e Resultados': ['PLR - Participação nos lucros e resultados', 'despesa_operacional', 'fixo'],
    'Gratificações': ['Gratificações', 'despesa_operacional', 'fixo'],
    'Rescisões': ['Rescisões', 'despesa_operacional', 'fixo'],
    'Vale-Alimentação': ['Vales', 'despesa_operacional', 'fixo'],
    'Vale-Transporte': ['Vales', 'despesa_operacional', 'fixo'],
    'FGTS e Multa de FGTS': ['FGTS', 'despesa_operacional', 'fixo'],
    'INSS sobre Salários - GPS': ['INSS', 'despesa_operacional', 'fixo'],
    'INSS sobre Pró-labore - GPS': ['INSS', 'despesa_operacional', 'fixo'],
    'Exames Médicos': ['Exames médicos', 'despesa_operacional', 'fixo'],
    'Cursos e Treinamentos': ['Cursos e treinamentos', 'despesa_operacional', 'fixo'],
    'Móveis, Utensílios e Instalações Administrativos': ['Móveis, utensílios e instalações administrativas', 'despesa_operacional', 'fixo'],
    'Móveis, Utensílios e Instalações Comerciais': ['Móveis, utensílios e instalações administrativas', 'despesa_operacional', 'fixo'],
    'Materiais de Escritório': ['Materiais de escritório', 'despesa_operacional', 'fixo'],
    'Materiais de Limpeza e de Higiene': ['Materiais de limpeza e de higiene', 'despesa_operacional', 'fixo'],
    'Telefonia e Internet': ['Telefonia e internet', 'despesa_operacional', 'fixo'],
    'Telefonia Móvel': ['Telefonia e internet', 'despesa_operacional', 'fixo'],
    'Energia Elétrica': ['Energia elétrica', 'despesa_operacional', 'fixo'],
    'Condomínio': ['Condomínio', 'despesa_operacional', 'fixo'],
    'Aluguel': ['Aluguel', 'despesa_operacional', 'fixo'],
    'IPTU': ['IPTU', 'despesa_operacional', 'fixo'],
    'Lanches e Refeições': ['Lanches e refeições', 'despesa_operacional', 'fixo'],
    'Confraternizações': ['Confraternizações', 'despesa_operacional', 'fixo'],
    'Viagens e Representações': ['Viagens e representações', 'despesa_operacional', 'fixo'],
    'Fatura de cartão': ['Fatura de cartão', 'despesa_operacional', 'fixo'],
    'Fretes pagos': ['Fretes pagos', 'custo', 'variavel'],
    'Devolução': ['Devoluções a clientes', 'deducao', 'variavel'],
    'Despesas a identificar': ['Despesas a identificar', 'outra_despesa', 'fixo'],
    'Empréstimos de Sócios': ['Devolução de empréstimos e aportes', FORA, 'fixo'],
    'Empréstimos de Bancos': ['Pagamento de empréstimos', FORA, 'fixo'],
    'Empréstimos de Outras Instituições': ['Pagamento de empréstimos', FORA, 'fixo'],
    'Antecipação de Lucros': ['Distribuição de lucros', FORA, 'fixo'],
    'Transferência de Saída': ['Transferência entre contas (saída)', FORA, 'fixo'],
    'Antecipação': ['Antecipação Asaas (baixa)', FORA, 'fixo'],
  },
};
// Movimentos de reserva e aportes que o Conta Azul deixou "a identificar": mexem no caixa, mas não são resultado.
const POR_DESCRICAO = [
  { re: /^reserva\b/i, receita: ['Resgate de reserva', FORA], despesa: ['Aplicação em reserva', FORA, 'fixo'] },
  { re: /^aporte\b/i, receita: ['Aporte de sócios', FORA], despesa: ['Devolução de aporte a sócios', FORA, 'fixo'] },
];
// Categorias em que a descrição do Conta Azul é o nome do cliente/fornecedor (quando a coluna própria veio vazia).
const DESCRICAO_E_CONTATO = new Set(['Receitas de Serviços', 'Receitas de Vendas', 'Remuneração de Autônomos', 'Remuneração de Estagiários', 'Pró-labore', 'Plataforma', 'Software / Licença de Uso', 'Comissões de Vendedores']);
const GENERICA = /^(transacao|pagamento via|cobranca|venda \d|antecipacao|origem:|baixa da|fatura|pix)/i;

// Forma de pagamento do Conta Azul → FinVision.
const FORMA = { 'Pagamento instantâneo': 'Pix', 'Cobrança PIX': 'Pix', 'Boleto bancário': 'Boleto bancário', 'Transferência bancária': 'Transferência bancária', 'Cartão de crédito': 'Cartão de crédito', 'Cartão de débito': 'Cartão de débito', 'Dinheiro': 'Dinheiro', 'Outro': 'Outro' };

// ---------- Leitura ----------
const iso = (d) => (/^\d{2}\/\d{2}\/\d{4}$/.test(d) ? d.split('/').reverse().join('-') : null);
const centavos = (v) => Math.round(Math.abs(Number(String(v).replace(',', '.')) || 0) * 100);
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const chaveContato = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const limparNome = (s) => s.replace(/\s*-\s*nova venda\s*$/i, '').replace(/\s+/g, ' ').trim();

const linhas = JSON.parse(readFileSync(arquivo, 'utf8'));
const avisos = [];
const itens = [];
for (const [i, l] of linhas.entries()) {
  const tipoCA = l.Tipo === 'Receita' ? 'receita' : l.Tipo === 'Despesa' ? 'despesa' : null;
  const valorPago = centavos(l['Valor (R$)']);
  if (!tipoCA || !valorPago) { avisos.push(`linha ${i + 2} ignorada (${l['Descrição'] || l['Categoria 1']}: valor zero ou tipo desconhecido)`); continue; }
  const descricao = String(l['Descrição'] ?? '').replace(/\s+/g, ' ').trim();
  const regra = POR_DESCRICAO.find((r) => r.re.test(descricao) && /identificar|Empréstimos de Sócios/i.test(l['Categoria 1']));
  const classe = DESTINO[tipoCA][l['Categoria 1']];
  const destino = regra ? regra[tipoCA] : classe && [l['Categoria 1'], ...classe.slice(1)];
  if (!destino) throw new Error(`Categoria sem destino: "${l['Categoria 1']}" (${tipoCA}). Inclua-a em DESTINO.`);
  const aberto = l['Situação'] === 'Em aberto';
  let contato = limparNome(String(l['Nome do fornecedor/cliente'] ?? ''));
  if (!contato && DESCRICAO_E_CONTATO.has(l['Categoria 1']) && descricao && !GENERICA.test(descricao)) contato = limparNome(descricao);
  const [parcela, total] = String(l['Quantidade de recorrência'] ?? '').split('/').map(Number);
  itens.push({
    linha: i + 2,
    tipo: tipoCA === 'receita' ? 'receber' : 'pagar',
    categoria: destino,
    categoriaCA: l['Categoria 1'],
    conta: String(l['Conta bancária']).trim(),
    descricao: descricao || l['Categoria 1'],
    contato,
    valor: centavos(l['Valor original (R$)']) || valorPago,
    valorPago: aberto ? null : valorPago,
    vencimento: iso(l['Data original de vencimento']) ?? iso(l['Data movimento']),
    pagamento: aberto ? null : iso(l['Data movimento']),
    documento: String(l['Nota fiscal'] ?? '').trim() || null,
    observacao: [MARCA, String(l['Observações'] ?? '').trim()].filter(Boolean).join(' — '),
    recorrente: l['Recorrência'] === 'Com recorrência' && total > 1 ? { parcela, total } : null,
    formaPagamento: FORMA[String(l['Forma de pgto/recbto'] ?? '').trim()] ?? null,
    centroCusto: String(l['Centro de Custo 1'] ?? '').trim() || null,
    dataPrevista: iso(l['Data prevista']),
    novaVenda: /nova venda/i.test(descricao),
  });
}

// Mesmo cliente escrito de jeitos diferentes ("Pool.Mind", "PoolMind", "POOLMIND") vira um nome só: o mais usado.
const grafias = new Map();
for (const it of itens.filter((x) => x.contato)) {
  const k = chaveContato(it.contato);
  if (!grafias.has(k)) grafias.set(k, new Map());
  grafias.get(k).set(it.contato, (grafias.get(k).get(it.contato) ?? 0) + 1);
}
const nomeFinal = new Map([...grafias].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
for (const it of itens) if (it.contato) it.contato = nomeFinal.get(chaveContato(it.contato));

// Recorrências do Conta Azul viram grupos de parcelas (mesma descrição/cliente, mesmo total de meses).
const grupos = new Map();
for (const it of itens.filter((x) => x.recorrente)) {
  const k = [it.tipo, chaveContato(it.contato || it.descricao), it.categoria[0], it.recorrente.total].join('|');
  if (!grupos.has(k)) grupos.set(k, randomUUID());
  it.grupo = grupos.get(k);
}

// Tipo de receita (Forecast) só para receitas de venda. Nova venda só quando a descrição diz "nova venda" (como no contrato).
itens.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.linha - b.linha);
const ultimaReceita = new Map();
for (const it of itens.filter((x) => x.tipo === 'receber' && x.categoria[1] === 'receita_bruta')) {
  const k = it.contato ? chaveContato(it.contato) : null;
  const anterior = k ? ultimaReceita.get(k) : null;
  const recente = anterior && (new Date(it.vencimento) - new Date(anterior)) / 86400000 <= 62;
  it.tipoReceita = it.novaVenda ? 'nova' : it.recorrente || recente ? 'recorrente' : 'avulsa';
  if (k) ultimaReceita.set(k, it.vencimento);
}

// ---------- Contas e saldos iniciais ----------
const saldos = new Map(args.flatMap((a, i) => (args[i - 1] === '--saldo' ? [a.split('=')] : [])).map(([n, v]) => [n.trim(), centavos(v)]));
const primeiraData = itens.reduce((m, it) => (it.pagamento && it.pagamento < m ? it.pagamento : m), '9999-12-31');
const dataSaldo = primeiraData.slice(0, 8) + '01';
const contas = [...new Set(itens.map((it) => it.conta))];
for (const n of saldos.keys()) if (!contas.includes(n)) throw new Error(`--saldo: conta "${n}" não existe na planilha.`);

// ---------- Prévia ----------
const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const empresa = await get(
  `SELECT e.id, e.nome, e.segmento, (SELECT COUNT(*) FROM lancamentos WHERE empresa_id = e.id) AS lancamentos,
     (SELECT COUNT(*) FROM lancamentos WHERE empresa_id = e.id AND observacao LIKE :marca) AS importados
   FROM empresas e WHERE regexp_replace(COALESCE(e.documento, ''), '\\D', '', 'g') = :cnpj`,
  { cnpj, marca: MARCA + '%' },
);
if (!empresa) throw new Error(`Nenhuma empresa com CNPJ ${cnpj} no FinVision.`);
const catsExistentes = await all('SELECT id, nome, tipo FROM categorias WHERE empresa_id = :eid', { eid: empresa.id });
const contasExistentes = await all('SELECT id, nome FROM contas_bancarias WHERE empresa_id = :eid', { eid: empresa.id });
const achaCat = (nome, tipo) => catsExistentes.find((c) => c.tipo === tipo && chaveNome(c.nome) === chaveNome(nome));
const achaConta = (nome) => contasExistentes.find((c) => chaveNome(c.nome) === chaveNome(nome));

console.log(`\nEmpresa: ${empresa.nome} (id ${empresa.id}, ${empresa.segmento}) — já tem ${empresa.lancamentos} lançamentos (${empresa.importados} de importação anterior)`);
if (refazer) console.log(`--refazer: apaga os ${empresa.importados} importados antes, mantém os ${empresa.lancamentos - empresa.importados} lançados à mão e remove categorias e contatos que ficarem sem uso.`);
console.log(`Planilha: ${linhas.length} linhas → ${itens.length} lançamentos (${itens.filter((x) => !x.pagamento).length} em aberto)`);
avisos.forEach((a) => console.log('  aviso:', a));

console.log(`\nContas (saldo inicial em ${dataSaldo}):`);
for (const c of contas) {
  const mov = itens.filter((it) => it.conta === c && it.pagamento).reduce((s, it) => s + (it.tipo === 'receber' ? it.valorPago : -it.valorPago), 0);
  const ini = saldos.get(c) ?? 0;
  console.log(`  ${achaConta(c) ? 'usa ' : 'cria'} ${c.padEnd(28)} saldo inicial ${reais(ini).padStart(13)} | movimentos ${reais(mov).padStart(14)} | saldo hoje ${reais(ini + mov).padStart(13)}`);
}

const porCategoria = new Map();
for (const it of itens) {
  const k = `${it.tipo === 'receber' ? 'R' : 'D'}|${it.categoria[0]}`;
  const c = porCategoria.get(k) ?? { cat: it.categoria, tipo: it.tipo, n: 0, total: 0, origem: new Set() };
  c.n++; c.total += it.valorPago ?? it.valor; c.origem.add(it.categoriaCA);
  porCategoria.set(k, c);
}
console.log('\nCategorias (FinVision ← Conta Azul):');
for (const c of [...porCategoria.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || b.total - a.total)) {
  const tipoCat = c.tipo === 'receber' ? 'receita' : 'despesa';
  console.log(`  ${c.tipo === 'receber' ? '+' : '−'} ${achaCat(c.cat[0], tipoCat) ? 'usa ' : 'cria'} ${c.cat[0].padEnd(46)} ${c.cat[1].padEnd(19)} ${String(c.n).padStart(4)}x ${reais(c.total).padStart(14)}  ← ${[...c.origem].join(', ')}`);
}

const contatosDistintos = new Set(itens.filter((x) => x.contato).map((x) => chaveContato(x.contato)));
const tipos = itens.filter((x) => x.tipoReceita).reduce((m, x) => ({ ...m, [x.tipoReceita]: (m[x.tipoReceita] ?? 0) + 1 }), {});
console.log(`\nClientes/fornecedores: ${contatosDistintos.size} | lançamentos sem contato: ${itens.filter((x) => !x.contato).length}`);
console.log(`Receitas de serviço por tipo: ${JSON.stringify(tipos)} | grupos de recorrência: ${grupos.size}`);
const soma = (f) => itens.filter(f).reduce((s, it) => s + (it.valorPago ?? 0), 0);
console.log(`Recebido ${reais(soma((x) => x.tipo === 'receber'))} | pago ${reais(soma((x) => x.tipo === 'pagar'))} | fora do resultado: entradas ${reais(soma((x) => x.tipo === 'receber' && x.categoria[1] === FORA))}, saídas ${reais(soma((x) => x.tipo === 'pagar' && x.categoria[1] === FORA))}`);

if (!gravar) {
  console.log('\nPrévia apenas — nada foi gravado. Rode de novo com --gravar para importar.');
  await sql.end();
  process.exit(0);
}
if (empresa.lancamentos > 0 && !refazer) throw new Error('A empresa já tem lançamentos; a importação só roda numa empresa vazia para não duplicar (use --refazer para trocar uma importação anterior).');

// ---------- Gravação (tudo ou nada) ----------
await transaction(async () => {
  if (refazer) await all('DELETE FROM lancamentos WHERE empresa_id = :eid AND observacao LIKE :marca', { eid: empresa.id, marca: MARCA + '%' });
  const idConta = new Map();
  for (const c of contas) {
    const existente = achaConta(c);
    idConta.set(c, existente ? existente.id : (await get(
      'INSERT INTO contas_bancarias (empresa_id, nome, banco, saldo_inicial, data_saldo_inicial) VALUES (:eid, :nome, :banco, :saldo, :data) RETURNING id',
      { eid: empresa.id, nome: c, banco: c.split(/[\s-]/)[0], saldo: saldos.get(c) ?? 0, data: dataSaldo },
    )).id);
  }
  const idCat = new Map();
  for (const c of porCategoria.values()) {
    const tipoCat = c.tipo === 'receber' ? 'receita' : 'despesa';
    const k = `${tipoCat}|${c.cat[0]}`;
    if (idCat.has(k)) continue;
    const existente = achaCat(c.cat[0], tipoCat);
    idCat.set(k, existente ? existente.id : (await get(
      'INSERT INTO categorias (empresa_id, nome, tipo, dre, grupo_forecast) VALUES (:eid, :nome, :tipo, :dre, :grupo) RETURNING id',
      { eid: empresa.id, nome: c.cat[0], tipo: tipoCat, dre: c.cat[1], grupo: tipoCat === 'despesa' ? c.cat[2] : null },
    )).id);
  }
  // Cada contato é resolvido uma vez; os lançamentos vão em lotes (uma consulta por lote: o pooler do Supabase é lento para mil idas e voltas).
  const contatos = new Map();
  for (const it of itens.filter((x) => x.contato)) {
    const k = `${it.tipo}|${it.contato}`;
    if (!contatos.has(k)) contatos.set(k, await resolverContato(empresa.id, it.contato, it.tipo));
  }
  const registros = itens.map((it) => {
    const contato = it.contato ? contatos.get(`${it.tipo}|${it.contato}`) : null;
    return {
      empresa_id: empresa.id, tipo: it.tipo, descricao: it.descricao, contato: contato?.nome ?? null, contato_id: contato?.id ?? null,
      tipo_receita: it.tipoReceita ?? null, categoria_id: idCat.get(`${it.tipo === 'receber' ? 'receita' : 'despesa'}|${it.categoria[0]}`),
      conta_bancaria_id: idConta.get(it.conta), valor: it.valor, vencimento: it.vencimento, documento: it.documento, observacao: it.observacao,
      data_pagamento: it.pagamento, valor_pago: it.valorPago, origem_baixa: it.pagamento ? 'manual' : null,
      grupo_parcelas: it.grupo ?? null, parcela: it.recorrente?.parcela ?? null, total_parcelas: it.recorrente?.total ?? null,
      forma_pagamento: it.formaPagamento, centro_custo: it.centroCusto, data_prevista: it.dataPrevista,
    };
  });
  const COLUNAS = Object.keys(registros[0]).join(', ');
  for (let i = 0; i < registros.length; i += 250) {
    await all(
      `INSERT INTO lancamentos (${COLUNAS}) SELECT ${COLUNAS} FROM json_populate_recordset(null::lancamentos, (:dados::text)::json)`,
      { dados: JSON.stringify(registros.slice(i, i + 250)) },
    );
  }
  const pares = await vincularTransferencias(empresa.id);
  if (pares) console.log(`Transferências entre contas ligadas: ${pares} par(es) (não contam como receita/despesa).`);
  if (refazer) {
    // Categorias e contatos que sobraram sem nenhum lançamento (nomes antigos) saem do cadastro.
    const cats = await all('DELETE FROM categorias c WHERE empresa_id = :eid AND NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.categoria_id = c.id) RETURNING nome', { eid: empresa.id });
    const cts = await all('DELETE FROM contatos c WHERE empresa_id = :eid AND NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.contato_id = c.id) RETURNING nome', { eid: empresa.id });
    console.log(`Removidas ${cats.length} categorias sem uso (${cats.map((c) => c.nome).join(', ')}) e ${cts.length} contatos sem uso.`);
  }
});
console.log(`\nImportado: ${itens.length} lançamentos na empresa ${empresa.nome}.`);
await sql.end();

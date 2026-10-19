// Cria a "Empresa Demo Ltda" para um usuário já cadastrado, com movimentos em torno de hoje,
// e gera exemplos/extrato-demo.ofx para testar a conciliação.
// Uso: npm run db:seed -- voce@email.com
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql, get, all, transaction, hoje } from '../server/db.js';
import { addDays, addMonths } from '../server/util.js';
import { criarCategoriasPadrao, inserirLancamento } from '../server/api.js';

const email = process.argv[2];
if (!email) {
  console.error('Informe o e-mail de um usuário já cadastrado: npm run db:seed -- voce@email.com');
  process.exit(1);
}

try {
  const usuario = await get('SELECT id FROM auth.users WHERE lower(email) = lower(:email)', { email });
  if (!usuario) throw new Error(`Nenhum usuário com o e-mail ${email}. Crie a conta pela tela de login primeiro.`);
  const h = hoje();

  const extrato = await transaction(async () => {
    const { id: eid } = await get("INSERT INTO empresas (nome, documento) VALUES ('Empresa Demo Ltda', '12.345.678/0001-90') RETURNING id");
    await all("INSERT INTO membros (empresa_id, user_id, papel) VALUES (:eid, :uid, 'dono')", { eid, uid: usuario.id });
    await criarCategoriasPadrao(eid);
    const cat = Object.fromEntries((await all('SELECT nome, id FROM categorias WHERE empresa_id = :eid', { eid })).map((c) => [c.nome, c.id]));
    const conta = async (nome, banco, saldo) =>
      (
        await get(
          'INSERT INTO contas_bancarias (empresa_id, nome, banco, saldo_inicial, data_saldo_inicial) VALUES (:eid, :nome, :banco, :saldo, :data) RETURNING id',
          { eid, nome, banco, saldo, data: addDays(h, -75) },
        )
      ).id;
    const itau = await conta('Conta Corrente', 'Itaú', 2_500_000);
    const nubank = await conta('Conta PJ', 'Nubank', 300_000);

    const extrato = [];
    const lanc = async (tipo, descricao, contato, categoria, valor, venc, { pagoEm, contaId = itau } = {}) => {
      await inserirLancamento({
        empresa_id: eid, tipo, descricao, contato, categoria_id: cat[categoria], conta_bancaria_id: contaId,
        valor, vencimento: venc, documento: null, observacao: null,
        data_pagamento: pagoEm ?? null, valor_pago: pagoEm ? valor : null, origem_baixa: pagoEm ? 'manual' : null,
      });
      if (pagoEm && contaId === itau && pagoEm >= addDays(h, -30) && pagoEm <= h) {
        extrato.push({ data: pagoEm, valor: tipo === 'receber' ? valor : -valor, memo: `${tipo === 'receber' ? 'PIX RECEBIDO' : 'PAGTO'} ${contato}`.toUpperCase() });
      }
    };

    const inicioMes = h.slice(0, 8) + '01';
    for (let m = -2; m <= 3; m++) {
      const mes = addMonths(inicioMes, m);
      const passado = (d) => (d < addDays(h, -2) ? { pagoEm: d } : {});
      await lanc('pagar', 'Aluguel do escritório', 'Imobiliária Central', 'Aluguel', 450_000, addDays(mes, 4), passado(addDays(mes, 4)));
      await lanc('pagar', 'Folha de pagamento', 'Funcionários', 'Salários e encargos', 1_850_000, addDays(mes, 4), passado(addDays(mes, 4)));
      await lanc('pagar', 'Licenças de software', 'Google Workspace', 'Software e serviços', 38_900, addDays(mes, 9), passado(addDays(mes, 9)));
      await lanc('pagar', 'DAS Simples Nacional', 'Receita Federal', 'Impostos', 312_000, addDays(mes, 19), passado(addDays(mes, 19)));
      await lanc('receber', 'Consultoria mensal', 'Alfa Indústria S.A.', 'Prestação de serviços', 1_200_000, addDays(mes, 9), passado(addDays(mes, 10)));
      await lanc('receber', 'Suporte técnico', 'Beta Comércio Ltda', 'Prestação de serviços', 680_000, addDays(mes, 14), passado(addDays(mes, 14)));
      await lanc('receber', 'Licença do sistema', 'Gama Serviços ME', 'Vendas de produtos', 245_000, addDays(mes, 24), passado(addDays(mes, 25)));
    }

    // Vencido em aberto que foi pago no banco mas não baixado: a conciliação vai encontrá-lo.
    await lanc('pagar', 'Compra de materiais', 'Papelaria Moderna', 'Fornecedores', 87_450, addDays(h, -6));
    extrato.push({ data: addDays(h, -5), valor: -87_450, memo: 'PIX ENVIADO PAPELARIA MODERNA' });
    await lanc('receber', 'Projeto de implantação', 'Delta Logística', 'Prestação de serviços', 950_000, addDays(h, -4));
    await lanc('pagar', 'Campanha de anúncios', 'Meta Ads', 'Marketing', 150_000, addDays(h, -1));
    await lanc('pagar', 'Manutenção de equipamentos', 'TecFix Assistência', 'Fornecedores', 64_000, h);
    await lanc('receber', 'Treinamento in company', 'Épsilon Educação', 'Prestação de serviços', 420_000, addDays(h, 3));
    await lanc('pagar', 'Energia elétrica', 'Enel', 'Outras despesas', 52_380, addDays(h, 5), { contaId: nubank });

    // Só no banco: tarifa e rendimento, para testar "criar lançamento a partir do extrato".
    extrato.push({ data: addDays(h, -12), valor: -4_590, memo: 'TARIFA PACOTE DE SERVICOS' });
    extrato.push({ data: addDays(h, -2), valor: 1_234, memo: 'RENDIMENTO APLIC AUTOMATICA' });
    return extrato;
  });

  escreverOfx(extrato.sort((a, b) => a.data.localeCompare(b.data)));
  console.log(`Empresa Demo criada para ${email}. Extrato de exemplo em exemplos/extrato-demo.ofx (importe na conta "Conta Corrente").`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

function escreverOfx(itens) {
  const dt = (d) => d.replaceAll('-', '') + '120000[-3:BRT]';
  const corpo = itens
    .map(
      (it, i) => `<STMTTRN>
<TRNTYPE>${it.valor > 0 ? 'CREDIT' : 'DEBIT'}
<DTPOSTED>${dt(it.data)}
<TRNAMT>${(it.valor / 100).toFixed(2)}
<FITID>DEMO${it.data.replaceAll('-', '')}${String(i).padStart(4, '0')}
<MEMO>${it.memo}
</STMTTRN>`,
    )
    .join('\n');
  const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0341
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${dt(itens[0].data)}
<DTEND>${dt(itens.at(-1).data)}
${corpo}
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;
  const dir = fileURLToPath(new URL('../exemplos/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + 'extrato-demo.ofx', ofx, 'latin1');
}

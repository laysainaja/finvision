import { useEmpresa } from '../lib/empresa';

/** Logo da empresa aberta (cadastrado em Configurações), no canto do topo dos relatórios e no PDF. */
export function LogoEmpresa() {
  const { empresa } = useEmpresa();
  if (!empresa?.logo) return null;
  return <img className="logo-relatorio" src={empresa.logo} alt={`Logo de ${empresa.nome}`} />;
}

/** Topo de relatório: título e descrição à esquerda, logo da empresa à direita (também sai no PDF). */
export function TopoRelatorio({ titulo, descricao, periodo }: { titulo: string; descricao: string; periodo?: string }) {
  const { empresa } = useEmpresa();
  return (
    <div className="page-header topo-relatorio">
      <div>
        <div className="so-impressao muted small">{empresa?.nome}{empresa?.documento ? ` · ${empresa.documento}` : ''}{periodo ? ` · ${periodo}` : ''}</div>
        <h1>{titulo}</h1>
        <p>{descricao}</p>
      </div>
      <LogoEmpresa />
    </div>
  );
}

/**
 * Reduz a imagem escolhida para caber em 480×200 e devolve um data URL leve (PNG; WebP se ainda ficar grande).
 * Assim o logo não pesa no banco nem na página.
 */
export function prepararLogo(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(arquivo.type)) return reject(new Error('Escolha uma imagem (PNG, JPG ou WebP).'));
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 480 / img.width, 200 / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * escala));
      canvas.height = Math.max(1, Math.round(img.height * escala));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let dados = canvas.toDataURL('image/png');
      if (dados.length > 300_000) dados = canvas.toDataURL('image/webp', 0.85);
      if (dados.length > 380_000) return reject(new Error('Imagem grande demais mesmo reduzida. Use um logo mais simples.'));
      resolve(dados);
    };
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('Não foi possível ler a imagem.')));
    img.src = url;
  });
}

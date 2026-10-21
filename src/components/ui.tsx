import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Status } from '../types';
import { num } from '../lib/format';

// ---------- Ícones (traço simples, herdam a cor do texto) ----------

const paths: Record<string, string> = {
  painel: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  pagar: 'M12 19V5M5 12l7 7 7-7',
  receber: 'M12 5v14M5 12l7-7 7 7',
  fluxo: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  banco: 'M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M2 21h20M12 3l9 5H3z',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  mais: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  editar: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  lixo: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  desfazer: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  raio: 'M13 2 3 14h9l-1 8 10-12h-9z',
  alerta: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  busca: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  dinheiro: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  extrato: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  predio: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4',
  seta: 'm6 9 6 6 6-6',
  esquerda: 'm15 18-6-6 6-6',
  direita: 'm9 18 6-6-6-6',
  filtro: 'M22 3H2l8 9.46V19l4 2v-8.54z',
  pontos: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  entrar: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
};

export function Icon({ name, size }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden>
      <path d={paths[name]} />
    </svg>
  );
}

// ---------- Modal ----------

export function Modal({ titulo, onClose, children, rodape, largura }: { titulo: string; onClose: () => void; children: ReactNode; rodape?: ReactNode; largura?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={largura ? { maxWidth: largura } : undefined} role="dialog" aria-modal aria-label={titulo}>
        <div className="modal-header">
          <h2>{titulo}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {rodape && <div className="modal-footer">{rodape}</div>}
      </div>
    </div>
  );
}

// ---------- Campos ----------

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={'field ' + (className ?? '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Campo de valor no padrão de máquina de cartão: os dígitos entram pela direita (1 → 0,01 → 0,12 → 1,23). */
export function MoneyInput({ value, onChange, autoFocus }: { value: number; onChange: (centavos: number) => void; autoFocus?: boolean }) {
  return (
    <input
      className="input money"
      inputMode="numeric"
      autoFocus={autoFocus}
      value={num(value)}
      onChange={(e) => onChange(Math.min(Number(e.target.value.replace(/\D/g, '') || 0), 99_999_999_999))}
      onFocus={(e) => e.target.select()}
    />
  );
}

const STATUS_LABEL: Record<Status, string> = { aberto: 'Em aberto', vencido: 'Vencido', pago: 'Pago' };
export function StatusBadge({ status, tipo }: { status: Status; tipo?: 'pagar' | 'receber' }) {
  const label = status === 'pago' && tipo === 'receber' ? 'Recebido' : STATUS_LABEL[status];
  return <span className={`badge badge-${status}`}>{label}</span>;
}

// ---------- Avisos (toasts) ----------

type Toast = { id: number; texto: string; erro?: boolean };
const ToastCtx = createContext<(texto: string, erro?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mostrar = useCallback((texto: string, erro?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, texto, erro }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), erro ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={'toast' + (t.erro ? ' erro' : '')}>
            {t.texto}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Executa uma ação da API mostrando sucesso/erro em toast. Retorna true se deu certo. */
export function useAcao() {
  const toast = useToast();
  return useCallback(
    async (fn: () => Promise<unknown>, sucesso?: string) => {
      try {
        await fn();
        if (sucesso) toast(sucesso);
        return true;
      } catch (e) {
        toast((e as Error).message, true);
        return false;
      }
    },
    [toast],
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import Modal from './Modal.jsx';
import {
  accounts,
  incomeCategories,
  expenseCategories,
  empty,
  money,
  balance,
  metrics,
  categoryName,
  normalize,
  inPeriod,
  saveEntry,
  voidEntry,
  reconcile,
  validate,
  importWithdrawals,
} from './domain.js';
import { transact, readRecovery } from './db.js';
import { readDulceria } from './bridge.js';
import './style.css';
const date = (at) =>
  new Date(at).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const localDate = (at) => {
  const d = new Date(at || Date.now());
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const accountName = (id) => accounts.find((a) => a.id === id)?.name;
const tabs = [
  ['home', '◈', 'Resumen'],
  ['history', '≋', 'Movimientos'],
  ['accounts', '▣', 'Cuentas'],
  ['dulceria', '↗', 'Dulcería'],
  ['backup', '↓', 'Respaldo'],
];
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>No pudimos abrir Economía</h1>
        <p>{this.state.error.message}</p>
        <button onClick={() => location.reload()}>Volver a intentar</button>
        <p>Tus registros locales se conservan.</p>
      </main>
    ) : (
      this.props.children
    );
  }
}
function EntryForm({ entry, type, busy, onSave }) {
  const [f, set] = useState({
    type: entry?.type || type,
    account: entry?.account || 'cash',
    toAccount: entry?.toAccount || 'bank',
    category: entry?.category || (type === 'income' ? 'work' : 'food'),
    value: entry ? (entry.amount / 100).toFixed(2) : '',
    note: entry?.note || '',
    when: localDate(entry?.at),
  });
  const field = (key) => (e) => set({ ...f, [key]: e.target.value });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...f, at: new Date(f.when).toISOString() }, entry?.id);
      }}
    >
      <label>
        Importe (MXN)
        <input
          autoFocus
          required
          inputMode="decimal"
          placeholder="0.00"
          value={f.value}
          onChange={field('value')}
        />
      </label>
      <div className="form-grid">
        <label>
          {f.type === 'transfer' ? 'Desde' : 'Cuenta'}
          <select value={f.account} onChange={field('account')}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {f.type === 'transfer' ? (
          <label>
            Hacia
            <select value={f.toAccount} onChange={field('toAccount')}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Categoría
            <select value={f.category} onChange={field('category')}>
              {Object.entries(f.type === 'income' ? incomeCategories : expenseCategories)
                .filter(([id]) => id !== 'dulceria')
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <label>
        Fecha y hora
        <input
          type="datetime-local"
          required
          value={f.when}
          max={localDate()}
          onChange={field('when')}
        />
      </label>
      <label>
        Nota (opcional)
        <input
          maxLength="500"
          placeholder="¿De qué fue este movimiento?"
          value={f.note}
          onChange={field('note')}
        />
      </label>
      {f.type === 'transfer' && (
        <p className="hint">Mueve saldo entre tus cuentas. No aumenta tus ingresos.</p>
      )}
      <button className="primary full" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar movimiento'}
      </button>
    </form>
  );
}
function ReconcileForm({ data, busy, onSave }) {
  const [f, set] = useState({
    cash: Math.max(0, balance(data, 'cash')) / 100,
    bank: Math.max(0, balance(data, 'bank')) / 100,
    note: data.initialized ? 'Conciliación de saldo actual' : 'Saldo inicial',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(f);
      }}
    >
      <p>
        Escribe lo que tienes <strong>en este momento</strong>, incluyendo el dinero de Dulcería que
        ya hayas retirado. Se registra solo la diferencia; no se vuelve a sumar como ingreso.
      </p>
      {accounts.map((a) => (
        <label key={a.id}>
          {a.name} real (MXN)
          <input
            required
            inputMode="decimal"
            value={f[a.id]}
            onChange={(e) => set({ ...f, [a.id]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Motivo
        <input
          required
          maxLength="500"
          value={f.note}
          onChange={(e) => set({ ...f, note: e.target.value })}
        />
      </label>
      <button className="primary full" disabled={busy}>
        Confirmar saldos actuales
      </button>
    </form>
  );
}
function App() {
  const [d, setD] = useState(null),
    [tab, setTab] = useState('home'),
    [period, setPeriod] = useState('month'),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [bridge, setBridge] = useState({ checking: true }),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [account, setAccount] = useState('all'),
    [limit, setLimit] = useState(30),
    [install, setInstall] = useState(null),
    [update, setUpdate] = useState(null),
    [online, setOnline] = useState(navigator.onLine),
    [lastExport, setLastExport] = useState(localStorage.getItem('economia-last-export') || '');
  const saving = useRef(false),
    syncing = useRef(false),
    channel = useRef(null),
    file = useRef(null),
    sourceFile = useRef(null);
  async function sync() {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const source = await readDulceria();
      let report = { added: 0, conflicts: 0, missing: 0, total: 0 };
      const next = await transact((x) => {
        if (source.found) report = importWithdrawals(x, source.withdrawals);
        return x;
      });
      setD(next);
      setBridge({ ...report, found: source.found, at: new Date().toISOString() });
      if (report.added) setNotice(`${report.added} retiro(s) de Dulcería incorporado(s).`);
    } catch (e) {
      setBridge({ error: e.message });
      try {
        setD(await transact());
      } catch (err) {
        setError(err.message);
      }
    } finally {
      syncing.current = false;
    }
  }
  useEffect(() => {
    sync();
    let sourceChannel;
    try {
      sourceChannel = new BroadcastChannel('dulceria-changes');
      sourceChannel.onmessage = sync;
      channel.current = new BroadcastChannel('economia-changes');
      channel.current.onmessage = () =>
        transact()
          .then(setD)
          .catch((e) => setError(e.message));
    } catch {}
    const focus = () => sync(),
      net = () => setOnline(navigator.onLine),
      prompt = (e) => {
        e.preventDefault();
        setInstall(e);
      };
    window.addEventListener('focus', focus);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    window.addEventListener('beforeinstallprompt', prompt);
    const timer = setInterval(() => {
      if (!document.hidden) sync();
    }, 60000);
    const sw = registerSW({
      onNeedRefresh() {
        setUpdate(() => sw);
      },
      onRegisterError() {
        setNotice('No se pudo preparar el modo sin conexión. Puedes seguir usando la aplicación.');
      },
    });
    return () => {
      clearInterval(timer);
      sourceChannel?.close();
      channel.current?.close();
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
      window.removeEventListener('beforeinstallprompt', prompt);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  async function commit(change, message, options) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      setD(await transact(change, options));
      channel.current?.postMessage('saved');
      setModal(null);
      setNotice(message);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function loadFile(e, source = false) {
    const input = e.target;
    try {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 20_000_000) throw Error('El archivo supera 20 MB.');
      const parsed = JSON.parse(await f.text());
      if (source) {
        if (parsed.schema !== 1 || !parsed.finance)
          throw Error('Elige un respaldo de Dulcería con retiros.');
        let report;
        await commit((x) => {
          report = importWithdrawals(x, parsed.finance.withdrawals || []);
          return x;
        }, 'Respaldo de Dulcería revisado.');
        if (report)
          setBridge({ ...report, found: true, fromFile: true, at: new Date().toISOString() });
      } else {
        validate(parsed);
        setModal({ type: 'restore', data: parsed });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      input.value = '';
    }
  }
  function backup() {
    const at = new Date().toISOString(),
      blob = new Blob([JSON.stringify({ ...d, exportedAt: at }, null, 2)], {
        type: 'application/json',
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `economia-${at.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    localStorage.setItem('economia-last-export', at);
    setLastExport(at);
    setNotice('Respaldo preparado. Revisa tus descargas.');
  }
  function openEntry(type, entry) {
    setError('');
    setModal({ type: 'entry', kind: type, entry });
  }
  if (!d)
    return (
      <div className="fatal">
        <div className="brand-icon">◈</div>
        <h1>Economía</h1>
        <p>{error || 'Preparando tu espacio…'}</p>
        {error && <button onClick={() => location.reload()}>Reintentar</button>}
      </div>
    );
  const m = metrics(d, period),
    cash = balance(d, 'cash'),
    bank = balance(d, 'bank'),
    linked = d.entries.filter((e) => e.sourceId),
    sorted = [...d.entries].sort((a, b) => new Date(b.at) - new Date(a.at)),
    filtered = sorted.filter(
      (e) =>
        inPeriod(e.at, period) &&
        (kind === 'all' || e.type === kind) &&
        (account === 'all' || e.account === account || e.toAccount === account) &&
        normalize(`${e.note} ${categoryName(e)}`).includes(normalize(query))
    );
  const actions = (
    <div className="actions">
      <button className="primary" onClick={() => openEntry('income')}>
        ＋ Ingreso
      </button>
      <button className="expense-button" onClick={() => openEntry('expense')}>
        − Gasto
      </button>
      <button onClick={() => openEntry('transfer')}>⇄ Transferir</button>
    </div>
  );
  function rows(entries) {
    return entries.map((e) => (
      <article className={`movement ${e.voided ? 'voided' : ''}`} key={e.id}>
        <span className={`movement-icon ${e.type}`}>
          {e.sourceId
            ? '↗'
            : e.type === 'income'
              ? '↓'
              : e.type === 'expense'
                ? '↑'
                : e.type === 'transfer'
                  ? '⇄'
                  : '≈'}
        </span>
        <div className="movement-body">
          <strong>{e.note || categoryName(e)}</strong>
          <small>
            {categoryName(e)} · {accountName(e.account)}
            {e.toAccount ? ` → ${accountName(e.toAccount)}` : ''}
          </small>
          <small>
            {date(e.at)}
            {e.sourceId ? ' · Vinculado' : e.voided ? ' · Anulado' : ''}
          </small>
        </div>
        <div className="movement-end">
          <b className={e.type === 'income' ? 'positive' : e.type === 'expense' ? 'negative' : ''}>
            {e.type === 'income' ? '+' : e.type === 'expense' ? '−' : ''}
            {money(e.amount)}
          </b>
          {!e.sourceId && e.type !== 'adjustment' && (
            <button
              className="text-button"
              aria-label={`Opciones de ${e.note || categoryName(e)}`}
              onClick={() => {
                setError('');
                setModal({ type: 'options', entry: e });
              }}
            >
              Opciones
            </button>
          )}
        </div>
      </article>
    ));
  }
  return (
    <div className="app">
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab('home');
          }}
        >
          <span className="brand-icon">◈</span>
          <span>
            economía<small>TU DINERO, EN ORDEN</small>
          </span>
        </a>
        <nav aria-label="Principal">
          {tabs.map(([id, icon, label]) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              onClick={() => {
                setTab(id);
                setLimit(30);
                setError('');
              }}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="local-dot" /> Datos en tu dispositivo<small>Personal · MXN · v1.0</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">TU ESPACIO PERSONAL</span>
            <h1>{tabs.find((t) => t[0] === tab)[2]}</h1>
          </div>
          <div className="status">{online ? '● Local y privado' : '● Sin conexión'}</div>
        </header>
        {error && (
          <div role="alert" className="alert error">
            {error}
            <button aria-label="Cerrar aviso" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {update && (
          <div className="alert">
            Hay una nueva versión.<button onClick={() => update(true)}>Actualizar</button>
          </div>
        )}
        {!d.initialized && (
          <div className="setup">
            <div>
              <strong>Empecemos con lo que ya tienes</strong>
              <p>Configura tu efectivo y tarjeta actuales para llevar un saldo real.</p>
            </div>
            <button onClick={() => setModal({ type: 'reconcile' })}>Configurar saldos →</button>
          </div>
        )}
        {(tab === 'home' || tab === 'history') && (
          <div className="toolbar">
            <div className="periods" aria-label="Periodo">
              {[
                ['today', 'Hoy'],
                ['week', '7 días'],
                ['month', 'Este mes'],
                ['all', 'Todo'],
              ].map(([id, name]) => (
                <button
                  key={id}
                  aria-pressed={period === id}
                  className={period === id ? 'selected' : ''}
                  onClick={() => {
                    setPeriod(id);
                    setLimit(30);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            {tab === 'history' && actions}
          </div>
        )}
        {tab === 'home' && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="eyebrow">SALDO DISPONIBLE · TODAS TUS CUENTAS</span>
                <div className="big-money">{money(cash + bank)}</div>
                <p>Lo que tienes hoy, para decidir mejor mañana.</p>
                {actions}
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="orbit" />
                <div className="coin">$</div>
                <span className="spark s1">✧</span>
                <span className="spark s2">＋</span>
              </div>
            </section>
            <div className="stats">
              <section className="card stat">
                <span>↓ Ingresos del periodo</span>
                <strong className="positive">{money(m.income)}</strong>
                <small>Trabajo, extras y retiros de tu negocio</small>
              </section>
              <section className="card stat">
                <span>↑ Gastos del periodo</span>
                <strong className="negative">{money(m.expense)}</strong>
                <small>Lo que salió de tus cuentas</small>
              </section>
              <section className="card stat">
                <span>◈ Diferencia del periodo</span>
                <strong>{money(m.net)}</strong>
                <small>Ingresos menos gastos</small>
              </section>
            </div>
            <div className="two-col">
              <section className="card">
                <div className="section-head">
                  <h2>Tus cuentas</h2>
                  <button className="text-button" onClick={() => setTab('accounts')}>
                    Ver cuentas →
                  </button>
                </div>
                {accounts.map((a) => (
                  <div className="account-line" key={a.id}>
                    <span className={`account-icon ${a.id}`}>{a.icon}</span>
                    <span>
                      {a.name}
                      <small>Saldo actual</small>
                    </span>
                    <strong>{money(balance(d, a.id))}</strong>
                  </div>
                ))}
              </section>
              <section className="card">
                <div className="section-head">
                  <h2>De dónde viene tu dinero</h2>
                  <span className="pill">Ingresos</span>
                </div>
                {m.sources.map((s, i) => (
                  <div className="source" key={s.id}>
                    <div className="row">
                      <span>
                        <i
                          style={{ background: ['#5ce3bc', '#64b5ff', '#b9a5ff', '#ffb5db'][i] }}
                        />
                        {s.name}
                      </span>
                      <b>{money(s.amount)}</b>
                    </div>
                    <div className="track">
                      <div
                        style={{
                          width: `${m.income ? (s.amount / m.income) * 100 : 0}%`,
                          background: ['#5ce3bc', '#64b5ff', '#b9a5ff', '#ffb5db'][i],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </section>
            </div>
            <div className="two-col">
              <section className="card">
                <div className="section-head">
                  <h2>Últimos movimientos</h2>
                  <button className="text-button" onClick={() => setTab('history')}>
                    Ver todos →
                  </button>
                </div>
                {m.entries.length ? (
                  rows([...m.entries].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5))
                ) : (
                  <Empty text="Tu historia empieza con el primer movimiento." />
                )}
              </section>
              <section className="card">
                <h2>En qué estás gastando</h2>
                {m.expenses.length ? (
                  m.expenses.map((s) => (
                    <div className="source" key={s.id}>
                      <div className="row">
                        <span>{s.name}</span>
                        <b>{money(s.amount)}</b>
                      </div>
                      <div className="track">
                        <div
                          style={{
                            width: `${(s.amount / m.expense) * 100}%`,
                            background: '#fa9eac',
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty text="Cuando registres gastos, aquí verás cómo se distribuyen." />
                )}
                <p className="hint">
                  Las transferencias y ajustes de saldo no cuentan como ingresos ni gastos.
                </p>
              </section>
            </div>
          </>
        )}
        {tab === 'history' && (
          <section className="card">
            <div className="filters">
              <label>
                Buscar
                <input
                  placeholder="Nota o categoría…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(30);
                  }}
                />
              </label>
              <label>
                Tipo
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="all">Todos</option>
                  <option value="income">Ingresos</option>
                  <option value="expense">Gastos</option>
                  <option value="transfer">Transferencias</option>
                  <option value="adjustment">Ajustes</option>
                </select>
              </label>
              <label>
                Cuenta
                <select value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="all">Todas</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">
              {filtered.length} movimientos · Los anulados permanecen en el historial y no afectan
              saldos.
            </p>
            {filtered.length ? (
              rows(filtered.slice(0, limit))
            ) : (
              <Empty text="No hay movimientos con estos filtros." />
            )}
            {filtered.length > limit && (
              <button className="full" onClick={() => setLimit(limit + 30)}>
                Mostrar más
              </button>
            )}
          </section>
        )}
        {tab === 'accounts' && (
          <>
            <div className="two-col">
              {accounts.map((a) => (
                <section className={`card account-card ${a.id}`} key={a.id}>
                  <span className="account-icon">{a.icon}</span>
                  <h2>{a.name}</h2>
                  <div className="account-value">{money(balance(d, a.id))}</div>
                  <p>Saldo calculado con tus movimientos registrados.</p>
                </section>
              ))}
            </div>
            <section className="card">
              <h2>Que el registro coincida con tu dinero</h2>
              <p>
                Cuenta tu efectivo y consulta tu tarjeta. Si hay una diferencia, registra el saldo
                real con un ajuste. El ajuste conserva el historial y no se presenta como ingreso o
                gasto.
              </p>
              <div className="actions">
                <button className="primary" onClick={() => setModal({ type: 'reconcile' })}>
                  {d.initialized ? 'Conciliar saldos' : 'Configurar saldos iniciales'}
                </button>
                <button onClick={() => openEntry('transfer')}>⇄ Transferir entre cuentas</button>
              </div>
              <p className="hint">
                La aplicación lleva un registro. No consulta tu banco ni mueve dinero real.
              </p>
            </section>
          </>
        )}
        {tab === 'dulceria' && (
          <>
            <section className="connection card">
              <span className="connection-icon">↗</span>
              <div>
                <span className="eyebrow">DOS APLICACIONES, UN MISMO CONTROL</span>
                <h2>Tu ganancia de Dulcería, aquí</h2>
                <p>
                  Solo se incorporan los retiros que registres para tu economía personal. Las
                  ventas, la reinversión y el dinero del negocio permanecen en Dulcería.
                </p>
              </div>
            </section>
            <div className="two-col">
              <section className="card">
                <div className="section-head">
                  <h2>Conexión local</h2>
                  <span className="pill">
                    {bridge.checking
                      ? 'Revisando'
                      : bridge.error
                        ? 'Revisar'
                        : bridge.found
                          ? 'Disponible'
                          : 'Sin datos'}
                  </span>
                </div>
                <p>
                  {bridge.error ||
                    (bridge.found
                      ? 'Los retiros se revisan al abrir esta aplicación, volver a ella y cada minuto mientras está visible.'
                      : 'Abre Dulcería en este mismo navegador y registra un retiro. Luego vuelve a Economía.')}
                </p>
                {bridge.at && (
                  <small>
                    Última revisión: {date(bridge.at)}
                    {bridge.fromFile ? ' · Archivo importado' : ''}
                  </small>
                )}
                {(bridge.conflicts > 0 || bridge.missing > 0) && (
                  <p className="alert">
                    Hay {bridge.conflicts || 0} retiros modificados y {bridge.missing || 0} que ya
                    no aparecen en el origen. Conservamos los ingresos anteriores para no alterar tu
                    historial. Revisa los respaldos antes de ajustar saldos.
                  </p>
                )}
                <div className="actions">
                  <button className="primary" onClick={sync}>
                    Revisar retiros
                  </button>
                  <a className="button" href="/dulceria/" target="_blank" rel="noreferrer">
                    Abrir Dulcería ↗
                  </a>
                </div>
                <p className="hint">
                  Funciona en el mismo dispositivo, navegador y dirección de GitHub Pages. No
                  sincroniza entre teléfonos ni con la nube.
                </p>
                <button onClick={() => sourceFile.current.click()}>
                  Importar respaldo de Dulcería
                </button>
                <input
                  hidden
                  type="file"
                  accept=".json,application/json"
                  ref={sourceFile}
                  onChange={(e) => loadFile(e, true)}
                />
              </section>
              <section className="card">
                <h2>Ganancia que ya retiraste</h2>
                <div className="account-value positive">
                  {money(linked.reduce((n, e) => n + e.amount, 0))}
                </div>
                <p>{linked.length} retiros vinculados en todo tu historial.</p>
                <ol className="steps">
                  <li>En Dulcería, abre Ganancias y registra un retiro.</li>
                  <li>Indica si lo recibes en efectivo o banco.</li>
                  <li>Abre Economía: el ingreso aparece una sola vez.</li>
                </ol>
                <p className="hint">
                  Estos movimientos conservan su origen y no se editan aquí. Un respaldo repetido
                  tampoco los duplica.
                </p>
              </section>
            </div>
            <section className="card">
              <h2>Historial del negocio</h2>
              {linked.length ? (
                rows(sorted.filter((e) => e.sourceId))
              ) : (
                <Empty text="Tus retiros personales aparecerán aquí." />
              )}
            </section>
          </>
        )}
        {tab === 'backup' && (
          <>
            <section className="card">
              <span className="eyebrow">TUS DATOS TE PERTENECEN</span>
              <h2>Un respaldo para estar tranquilo</h2>
              <p>
                Todo se guarda en este navegador. Descarga una copia con frecuencia y antes de
                cambiar de teléfono o borrar datos del navegador.
              </p>
              <div className="actions">
                <button className="primary" onClick={backup}>
                  ↓ Descargar respaldo JSON
                </button>
                <button onClick={() => file.current.click()}>Restaurar respaldo</button>
              </div>
              <input
                hidden
                ref={file}
                type="file"
                accept=".json,application/json"
                onChange={(e) => loadFile(e)}
              />
              <p className="hint">
                Última descarga preparada:{' '}
                {lastExport ? date(lastExport) : 'Todavía no has descargado un respaldo.'} Comprueba
                que el archivo esté guardado.
              </p>
              <button
                onClick={async () => {
                  try {
                    const previous = await readRecovery();
                    if (!previous) throw Error('No hay copia anterior a una restauración.');
                    validate(previous);
                    setModal({ type: 'restore', data: previous });
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Recuperar datos previos a la última restauración
              </button>
            </section>
            <section className="card">
              <h2>Economía en tu teléfono</h2>
              <p>
                Abre este enlace en Chrome para Android y elige «Agregar a pantalla principal» o
                «Instalar aplicación». Después de la primera carga podrás usarla sin conexión.
              </p>
              {install && (
                <button
                  className="primary"
                  onClick={async () => {
                    await install.prompt();
                    setInstall(null);
                  }}
                >
                  Instalar Economía
                </button>
              )}
              <p>
                Usa el mismo navegador donde guardas Dulcería. El modo incógnito, otro navegador o
                borrar los datos del sitio crea un almacenamiento distinto o elimina los registros.
              </p>
              <p className="hint">
                El código es público; tus movimientos no se suben a GitHub. Quien use la aplicación
                tendrá sus propios datos en su dispositivo. La conexión bancaria y las
                transferencias reales se hacen fuera de esta aplicación.
              </p>
            </section>
          </>
        )}
        <footer>
          Hecho para cuidar tu dinero. <span>Sin nube · Sin cuentas · Todo local</span>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          ✓ {notice}
        </div>
      )}
      {modal && (
        <Modal
          title={
            modal.type === 'entry'
              ? modal.entry
                ? 'Editar movimiento'
                : modal.kind === 'income'
                  ? 'Nuevo ingreso'
                  : modal.kind === 'expense'
                    ? 'Nuevo gasto'
                    : 'Transferir entre cuentas'
              : modal.type === 'reconcile'
                ? 'Tus saldos actuales'
                : modal.type === 'restore'
                  ? 'Restaurar respaldo'
                  : 'Opciones del movimiento'
          }
          busy={busy}
          onClose={() => {
            setModal(null);
            setError('');
          }}
        >
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          {modal.type === 'entry' && (
            <EntryForm
              entry={modal.entry}
              type={modal.kind}
              busy={busy}
              onSave={(f, id) => commit((x) => saveEntry(x, f, id), 'Movimiento guardado.')}
            />
          )}{' '}
          {modal.type === 'reconcile' && (
            <ReconcileForm
              data={d}
              busy={busy}
              onSave={(f) => commit((x) => reconcile(x, f), 'Saldos conciliados.')}
            />
          )}{' '}
          {modal.type === 'options' && (
            <>
              <p>
                {modal.entry.note || categoryName(modal.entry)} · {money(modal.entry.amount)}
              </p>
              {!modal.entry.voided && (
                <button
                  className="full"
                  onClick={() =>
                    setModal({ type: 'entry', kind: modal.entry.type, entry: modal.entry })
                  }
                >
                  Editar movimiento
                </button>
              )}
              <p className="hint">
                {modal.entry.voided
                  ? 'Al reactivar vuelve a afectar tus saldos.'
                  : 'Anular conserva el historial y revierte su efecto en tus saldos.'}
              </p>
              <button
                disabled={busy}
                className="full"
                onClick={() =>
                  commit(
                    (x) => voidEntry(x, modal.entry.id, !modal.entry.voided),
                    modal.entry.voided ? 'Movimiento reactivado.' : 'Movimiento anulado.'
                  )
                }
              >
                {modal.entry.voided ? 'Reactivar' : 'Anular movimiento'}
              </button>
            </>
          )}
          {modal.type === 'restore' && (
            <>
              <p>
                Este respaldo contiene {modal.data.entries.length} movimientos. Reemplazará los
                datos de Economía en este navegador. Conservaremos una copia previa para recuperarla
                desde esta pantalla.
              </p>
              <p>
                Dulcería no se modifica. Después se revisarán nuevamente sus retiros para incorporar
                los que falten.
              </p>
              <button
                className="primary full"
                disabled={busy}
                onClick={async () => {
                  if (await commit(() => modal.data, 'Respaldo restaurado.', { capture: true }))
                    sync();
                }}
              >
                Restaurar estos datos
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
function Empty({ text }) {
  return (
    <div className="empty">
      <span>◌</span>
      <p>{text}</p>
    </div>
  );
}
createRoot(document.getElementById('root')).render(
  <Boundary>
    <App />
  </Boundary>
);

export const MAX = 10_000_000_000;
export const accounts = [
  { id: 'cash', name: 'Efectivo', icon: '◉' },
  { id: 'bank', name: 'Tarjeta / banco', icon: '▣' },
];
export const incomeCategories = {
  work: 'Trabajo',
  extra: 'Regalos y extras',
  other: 'Otro ingreso',
  dulceria: 'Dulcería',
};
export const expenseCategories = {
  food: 'Comida',
  transport: 'Transporte',
  home: 'Casa',
  services: 'Servicios',
  health: 'Salud',
  shopping: 'Compras',
  leisure: 'Ocio',
  other: 'Otros gastos',
};
export const uid = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
export const money = (value) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value / 100);
export function cents(value) {
  const s = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw Error('Escribe un importe con hasta dos decimales.');
  const [w, f = ''] = s.split('.');
  const n = Number(w) * 100 + Number(f.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n > MAX) throw Error('El importe es demasiado grande.');
  return n;
}
export const empty = () => ({ schema: 1, app: 'economia', entries: [], initialized: false });
export const isAccount = (id) => accounts.some((a) => a.id === id);
export const balance = (d, account) =>
  d.entries
    .filter((e) => !e.voided)
    .reduce((n, e) => {
      if (e.type === 'transfer')
        return (
          n + (e.toAccount === account ? e.amount : 0) - (e.account === account ? e.amount : 0)
        );
      if (e.account !== account) return n;
      return n + (e.type === 'expense' ? -e.amount : e.amount);
    }, 0);
export function validate(d) {
  if (
    !d ||
    d.app !== 'economia' ||
    d.schema !== 1 ||
    !Array.isArray(d.entries) ||
    typeof d.initialized !== 'boolean'
  )
    throw Error('Este no es un respaldo compatible de Economía.');
  const ids = new Set(),
    sources = new Set();
  for (const e of d.entries) {
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id))
      throw Error('Identificadores de movimientos inválidos.');
    ids.add(e.id);
    if (
      !['income', 'expense', 'transfer', 'adjustment'].includes(e.type) ||
      !isAccount(e.account) ||
      !Number.isSafeInteger(e.amount) ||
      Math.abs(e.amount) > MAX ||
      (e.type !== 'adjustment' && e.amount <= 0) ||
      typeof e.at !== 'string' ||
      !Number.isFinite(Date.parse(e.at)) ||
      typeof e.note !== 'string' ||
      e.note.length > 500 ||
      typeof e.category !== 'string' ||
      (e.voided !== undefined && typeof e.voided !== 'boolean')
    )
      throw Error('Movimiento inválido.');
    if (e.type === 'transfer' && (!isAccount(e.toAccount) || e.toAccount === e.account))
      throw Error('Cuentas de transferencia inválidas.');
    if (e.sourceId !== undefined) {
      if (
        typeof e.sourceId !== 'string' ||
        !e.sourceId ||
        sources.has(e.sourceId) ||
        e.id !== `dulceria:${e.sourceId}` ||
        e.type !== 'income' ||
        e.category !== 'dulceria' ||
        e.source !== 'dulceria' ||
        e.voided
      )
        throw Error('Retiro importado inválido.');
      sources.add(e.sourceId);
    }
  }
  for (const a of accounts)
    if (!Number.isSafeInteger(balance(d, a.id))) throw Error('El saldo supera el rango permitido.');
  return d;
}
export function saveEntry(d, fields, id = uid()) {
  const previous = d.entries.find((e) => e.id === id);
  if (previous?.sourceId) throw Error('Los retiros vinculados no se editan ni anulan aquí.');
  if (previous?.voided) throw Error('Reactiva el movimiento antes de editarlo.');
  const type = fields.type;
  if (!['income', 'expense', 'transfer'].includes(type))
    throw Error('Elige ingreso, gasto o transferencia.');
  const amount = cents(fields.value);
  if (!amount) throw Error('El importe debe ser mayor a cero.');
  if (!isAccount(fields.account)) throw Error('Elige una cuenta válida.');
  if (type === 'transfer' && (!isAccount(fields.toAccount) || fields.toAccount === fields.account))
    throw Error('Elige dos cuentas diferentes.');
  if (
    type === 'transfer' &&
    amount > balance({ ...d, entries: d.entries.filter((e) => e.id !== id) }, fields.account)
  )
    throw Error('La cuenta de origen no tiene saldo suficiente para esa transferencia.');
  const categories = type === 'income' ? incomeCategories : expenseCategories;
  if (type !== 'transfer' && (!categories[fields.category] || fields.category === 'dulceria'))
    throw Error('Elige una categoría válida; Dulcería se vincula automáticamente.');
  const entry = {
    id,
    type,
    amount,
    account: fields.account,
    category: type === 'transfer' ? 'transfer' : fields.category,
    note: String(fields.note || '')
      .trim()
      .slice(0, 500),
    at: fields.at,
    voided: false,
  };
  if (type === 'transfer') entry.toAccount = fields.toAccount;
  if (previous) Object.assign(previous, entry);
  else d.entries.push(entry);
  return validate(d);
}
export function voidEntry(d, id, voided) {
  const e = d.entries.find((e) => e.id === id);
  if (!e) throw Error('Movimiento no encontrado.');
  if (e.sourceId) throw Error('Los retiros vinculados conservan su historial y no se anulan aquí.');
  e.voided = voided;
  return validate(d);
}
export function reconcile(
  d,
  {
    cash,
    bank,
    note = 'Saldo inicial / conciliación',
    at = new Date().toISOString(),
    operationId = uid(),
  }
) {
  if (
    d.entries.some(
      (e) => e.id === `adjustment:${operationId}:cash` || e.id === `adjustment:${operationId}:bank`
    )
  )
    throw Error('Esta conciliación ya está registrada.');
  for (const [account, value] of Object.entries({ cash, bank })) {
    const actual = cents(value),
      delta = actual - balance(d, account);
    d.entries.push({
      id: `adjustment:${operationId}:${account}`,
      type: 'adjustment',
      amount: delta,
      account,
      category: 'adjustment',
      note: String(note).trim().slice(0, 500),
      at,
      voided: false,
    });
  }
  d.initialized = true;
  return validate(d);
}
export function importWithdrawals(d, withdrawals) {
  if (!Array.isArray(withdrawals)) throw Error('Formato de retiros incompatible.');
  const seen = new Set();
  for (const w of withdrawals) {
    if (
      !w ||
      typeof w.id !== 'string' ||
      !w.id ||
      seen.has(w.id) ||
      w.source !== 'dulceria' ||
      w.integrationVersion !== 1 ||
      !Number.isSafeInteger(w.amount) ||
      w.amount <= 0 ||
      w.amount > MAX ||
      !isAccount(w.destination) ||
      typeof w.at !== 'string' ||
      !Number.isFinite(Date.parse(w.at)) ||
      typeof w.note !== 'string'
    )
      throw Error('Un retiro de Dulcería no es válido. No se importó ningún movimiento.');
    seen.add(w.id);
  }
  let added = 0,
    conflicts = 0;
  const index = new Map(d.entries.filter((e) => e.sourceId).map((e) => [e.sourceId, e]));
  for (const w of withdrawals) {
    const old = index.get(w.id);
    if (old) {
      if (old.amount !== w.amount || old.account !== w.destination || old.at !== w.at) conflicts++;
      continue;
    }
    d.entries.push({
      id: `dulceria:${w.id}`,
      sourceId: w.id,
      source: 'dulceria',
      type: 'income',
      category: 'dulceria',
      amount: w.amount,
      account: w.destination,
      note: w.note.slice(0, 500) || 'Retiro de ganancia de Dulcería',
      at: w.at,
      voided: false,
    });
    added++;
  }
  const missing = [...index.keys()].filter((id) => !seen.has(id)).length;
  validate(d);
  return { added, conflicts, missing, total: withdrawals.length };
}
export function inPeriod(at, period, now = new Date()) {
  if (period === 'all') return true;
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (period === 'week') from.setDate(from.getDate() - 6);
  if (period === 'month') from.setDate(1);
  return new Date(at) >= from && new Date(at) <= now;
}
export const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
export const categoryName = (e) =>
  e.type === 'transfer'
    ? 'Entre mis cuentas'
    : e.type === 'adjustment'
      ? 'Ajuste de saldo'
      : (e.type === 'income' ? incomeCategories : expenseCategories)[e.category] || e.category;
export function metrics(d, period, now = new Date()) {
  const entries = d.entries.filter((e) => !e.voided && inPeriod(e.at, period, now));
  const income = entries.filter((e) => e.type === 'income').reduce((n, e) => n + e.amount, 0),
    expense = entries.filter((e) => e.type === 'expense').reduce((n, e) => n + e.amount, 0);
  return {
    income,
    expense,
    net: income - expense,
    entries,
    sources: Object.keys(incomeCategories).map((id) => ({
      id,
      name: incomeCategories[id],
      amount: entries
        .filter((e) => e.type === 'income' && e.category === id)
        .reduce((n, e) => n + e.amount, 0),
    })),
    expenses: Object.keys(expenseCategories)
      .map((id) => ({
        id,
        name: expenseCategories[id],
        amount: entries
          .filter((e) => e.type === 'expense' && e.category === id)
          .reduce((n, e) => n + e.amount, 0),
      }))
      .filter((e) => e.amount > 0)
      .sort((a, b) => b.amount - a.amount),
  };
}

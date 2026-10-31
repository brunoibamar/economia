import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  empty,
  cents,
  balance,
  metrics,
  saveEntry,
  voidEntry,
  reconcile,
  importWithdrawals,
  validate,
} from '../src/domain.js';
import { transact, readRecovery } from '../src/db.js';
import { readDulceria } from '../src/bridge.js';
const at = '2026-10-30T15:00:00.000Z';
const withdrawal = (id = 'w1', amount = 30000) => ({
  id,
  amount,
  at,
  destination: 'cash',
  note: 'Ganancia retirada',
  source: 'dulceria',
  integrationVersion: 1,
});
const fields = (type, value, more = {}) => ({
  type,
  value,
  account: 'cash',
  category: type === 'income' ? 'work' : 'food',
  at,
  note: 'Prueba',
  ...more,
});
test('importes exactos en centavos y rechazo de entradas ambiguas', () => {
  assert.equal(cents('19,90'), 1990);
  assert.equal(cents('0.01'), 1);
  for (const s of ['-2', '1.234', 'NaN', '2+2', '1e3', '']) assert.throws(() => cents(s));
});
test('ingreso, gasto, transferencia y métricas separadas', () => {
  const d = empty();
  saveEntry(d, fields('income', '1000'), 'salary');
  saveEntry(d, fields('expense', '50'), 'lunch');
  saveEntry(d, fields('transfer', '100', { toAccount: 'bank' }), 'transfer');
  assert.equal(balance(d, 'cash'), 85000);
  assert.equal(balance(d, 'bank'), 10000);
  const m = metrics(d, 'all');
  assert.equal(m.income, 100000);
  assert.equal(m.expense, 5000);
  assert.equal(m.net, 95000);
  assert.throws(() => saveEntry(d, fields('transfer', '900', { toAccount: 'bank' })));
});
test('edición y anulación reversible conservan historial', () => {
  const d = empty();
  saveEntry(d, fields('income', '100'), 'a');
  saveEntry(d, fields('income', '150'), 'a');
  assert.equal(d.entries.length, 1);
  assert.equal(balance(d, 'cash'), 15000);
  voidEntry(d, 'a', true);
  assert.equal(balance(d, 'cash'), 0);
  assert.throws(() => saveEntry(d, fields('income', '5'), 'a'));
  voidEntry(d, 'a', false);
  assert.equal(balance(d, 'cash'), 15000);
});
test('retiros repetidos se importan exactamente una vez y no se editan', () => {
  const d = empty();
  assert.equal(importWithdrawals(d, [withdrawal()]).added, 1);
  assert.equal(importWithdrawals(d, [withdrawal()]).added, 0);
  assert.equal(balance(d, 'cash'), 30000);
  assert.throws(() => voidEntry(d, 'dulceria:w1', true));
  assert.throws(() => saveEntry(d, fields('income', '20'), 'dulceria:w1'));
  assert.throws(() => saveEntry(d, fields('income', '20', { category: 'dulceria' })));
});
test('cambios y ausencias en origen generan avisos sin alterar ingresos anteriores', () => {
  const d = empty();
  importWithdrawals(d, [withdrawal()]);
  assert.equal(importWithdrawals(d, [withdrawal('w1', 90000)]).conflicts, 1);
  assert.equal(balance(d, 'cash'), 30000);
  assert.equal(importWithdrawals(d, []).missing, 1);
  assert.equal(d.entries.length, 1);
});
test('un retiro inválido impide toda importación parcial', () => {
  const d = empty();
  assert.throws(() => importWithdrawals(d, [withdrawal(), { ...withdrawal('w2'), amount: 1.2 }]));
  assert.equal(d.entries.length, 0);
  assert.throws(() => importWithdrawals(d, [withdrawal(), withdrawal()]));
});
test('saldo inicial incluye dinero importado sin duplicarlo ni convertir ajuste en ingreso', () => {
  const d = empty();
  importWithdrawals(d, [withdrawal()]);
  reconcile(d, { cash: '379', bank: '1000', at, operationId: 'opening' });
  assert.equal(balance(d, 'cash'), 37900);
  assert.equal(balance(d, 'bank'), 100000);
  assert.equal(metrics(d, 'all').income, 30000);
  assert.equal(metrics(d, 'all').expense, 0);
  assert.throws(() => reconcile(d, { cash: '379', bank: '1000', operationId: 'opening' }));
  importWithdrawals(d, [withdrawal(), withdrawal('w2', 10000)]);
  assert.equal(balance(d, 'cash'), 47900);
});
test('filtros de periodo y categorías usan los movimientos activos', () => {
  const d = empty();
  saveEntry(d, fields('income', '10'), 'old');
  saveEntry(d, fields('income', '20', { at: '2026-11-01T12:00:00Z', category: 'extra' }), 'new');
  assert.equal(metrics(d, 'month', new Date('2026-11-02T18:00:00Z')).income, 2000);
  assert.equal(metrics(d, 'all').sources.find((s) => s.id === 'extra').amount, 2000);
  voidEntry(d, 'new', true);
  assert.equal(metrics(d, 'all').income, 1000);
});
test('validación de respaldo rechaza identificadores repetidos y formatos ajenos', () => {
  assert.throws(() => validate({ schema: 1, products: [] }));
  const d = empty();
  saveEntry(d, fields('income', '1'), 'same');
  d.entries.push({ ...d.entries[0] });
  assert.throws(() => validate(d));
});
test('IndexedDB serializa importaciones concurrentes y revierte errores', async () => {
  await transact(() => empty());
  await Promise.all(
    Array.from({ length: 5 }, () =>
      transact((d) => {
        importWithdrawals(d, [withdrawal()]);
        return d;
      })
    )
  );
  assert.equal((await transact()).entries.length, 1);
  await assert.rejects(
    transact((d) => {
      d.entries.push({ ...d.entries[0] });
      return d;
    })
  );
  assert.equal((await transact()).entries.length, 1);
  await transact(() => empty(), { capture: true });
  assert.equal((await readRecovery()).entries.length, 1);
  assert.equal((await transact()).entries.length, 0);
});
test('puente ausente no crea una base vacía y puente existente es de solo lectura', async () => {
  assert.deepEqual(await readDulceria(), { found: false, withdrawals: [] });
  assert.equal(
    (await indexedDB.databases()).some((d) => d.name === 'dulceria-local-v1'),
    false
  );
  const source = {
    schema: 1,
    products: [{ id: 'untouched' }],
    finance: { withdrawals: [withdrawal()] },
  };
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('dulceria-local-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('data');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  await new Promise((resolve) => {
    const tx = db.transaction('data', 'readwrite');
    tx.objectStore('data').put(source, 'main');
    tx.oncomplete = resolve;
  });
  assert.deepEqual(await readDulceria(), { found: true, withdrawals: [withdrawal()] });
  const preserved = await new Promise((resolve) => {
    const r = db.transaction('data').objectStore('data').get('main');
    r.onsuccess = () => resolve(r.result);
  });
  assert.deepEqual(preserved, source);
  db.close();
});

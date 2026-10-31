# Economía

Aplicación personal independiente de Dulcería. React + Vite + JavaScript + CSS, IndexedDB y PWA para Android. Sin base de datos en la nube, cuentas ni conexiones bancarias.

## Uso en el teléfono

Enlace: https://brunoibamar.github.io/economia/

1. Abre Economía en el **mismo navegador y dispositivo donde usas Dulcería**.
2. Antes de configurar saldos, abre Dulcería para que estén disponibles sus datos locales. Los retiros personales anteriores se incorporan una sola vez.
3. Pulsa **Configurar saldos**. Escribe todo el efectivo y saldo bancario que tienes actualmente, incluyendo cualquier retiro de Dulcería ya recibido. Se guarda la diferencia como ajuste, no como ingreso duplicado.
4. Registra ingresos por trabajo, regalos/extras u otros, y gastos con su cuenta y categoría.
5. Usa **Transferir** cuando muevas tu propio dinero entre efectivo y banco. La transferencia no cuenta como ingreso o gasto.
6. Desde Chrome para Android, menú → Instalar aplicación / Agregar a pantalla principal. Después de una carga completa funciona sin conexión.

El resumen distingue saldo total actual e ingresos/gastos del periodo. Los ajustes iniciales no inflan las métricas. El historial permite buscar, filtrar, editar y anular/reactivar movimientos manuales. Los gastos pueden dejar saldo negativo: concilia si el registro no coincide con tu dinero real.

## Conexión con Dulcería

- En Dulcería → Ganancias → **Retirar para mi Economía**, registra lo que realmente separas para ti e indica efectivo o banco.
- Economía consulta únicamente los retiros personales de `dulceria-local-v1`. Nunca copia ventas brutas, reinversión, inventario ni deudores.
- La lectura es local y de solo lectura. No altera los registros de Dulcería ni realiza transferencias de dinero.
- Importa cada identificador una sola vez, incluso al recargar, usar varias pestañas o importar un respaldo repetido.
- Revisa al abrir, al volver a la ventana y cada minuto mientras esté visible; también hay botón **Revisar retiros**.
- Los retiros importados conservan su origen y no se editan/anulan desde Economía.
- Si un retiro cambia o desaparece en un respaldo antiguo de Dulcería, Economía avisa y conserva el ingreso previo; no borra automáticamente tu historial.
- Ambos enlaces deben compartir origen: `https://brunoibamar.github.io/dulceria/` y `https://brunoibamar.github.io/economia/`. Un dominio personalizado distinto, otro navegador o dispositivo no comparten IndexedDB.
- Para mover datos entre dispositivos puedes importar un respaldo de Dulcería desde la sección Dulcería. Solo incorpora retiros, sin reemplazar tus movimientos personales.
- El estado interno `delivery: pending` de Dulcería se conserva por compatibilidad. El número de retiros incorporados se consulta en Economía; no significa que se haya movido dinero bancario.

## Respaldos y privacidad

En **Respaldo**, descarga JSON y comprueba que esté en Descargas. Restaurar reemplaza los registros de Economía y conserva una copia previa recuperable. Los retiros existentes en Dulcería se revisan de nuevo tras restaurar, para incorporar los que falten. Restaurar Economía no restaura ni cambia Dulcería: respalda ambas aplicaciones por separado.

Los datos están en `economia-local-v1`, almacén `data`, clave `main`, en este navegador. Borrar datos del sitio, modo incógnito, una limpieza del teléfono o pérdida del dispositivo puede eliminar los registros. No existe recuperación desde GitHub. **Guarda copias regularmente** y antes de cambiar de teléfono. No hay sincronización automática entre dispositivos.

El código publicado es público y el navegador recibe JavaScript legible/analizable. Tus registros no están en el repositorio. El respaldo JSON sí contiene tus movimientos y saldos: consérvalo en privado y no lo subas al repositorio.

## Desarrollo

Requiere Node 22+ y pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm preview
```

El servidor de desarrollo tiene otro origen: no lee los datos de GitHub Pages. Para comprobar la conexión local sirve ambos `dist/` bajo el mismo origen y rutas `/dulceria/` y `/economia/`. No abras `index.html` con `file://`.

## GitHub Pages

Repositorio: https://github.com/brunoibamar/economia

Ramas `main` y `movil-refactor`. El flujo `.github/workflows/pages.yml` prueba, compila y publica cada cambio en `main`. En Settings → Pages selecciona **GitHub Actions**. La base relativa de Vite y el alcance `/economia/` de la PWA permiten servir desde el subdirectorio sin interferir con la PWA de Dulcería.

No subas `node_modules`, datos reales ni respaldos. Para publicar cambios:

```sh
git add .
git commit -m "Describe el cambio"
git push origin main
```

La PWA avisa cuando hay una actualización; confirma para cargarla. Guardar datos y actualizar la aplicación son operaciones separadas.

## Verificación

Pruebas de centavos, saldos, transferencias, anulación, edición, filtros, deduplicación, validación de respaldos, importaciones concurrentes, reversión de transacciones y lectura de Dulcería sin escrituras. También se comprueba la interfaz y la integración con datos ficticios en una dirección local independiente.

// entrenador/sync-worker.js — Web Worker de sincronización offline
// Se ejecuta en segundo plano. NO tiene acceso al DOM.
// Comunicación con el hilo principal via postMessage.

const DB_NAME = 'jrstars_offline';
const DB_VERSION = 1;
const STORE = 'pending_scans';
const BATCH_URL = '/attendance/sync-batch';

// ── INDEXEDDB ─────────────────────────────────────────────
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'local_id' });
                store.createIndex('synced', 'synced');
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function queueRecord(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.put({ ...record, synced: false });
        req.onsuccess = () => resolve();
        req.onerror = e => reject(e.target.error);
    });
}

async function getPending() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const idx = store.index('synced');
        const req = idx.getAll(false);      // synced === false
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function markSynced(ids) {
    if (!ids.length) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        let done = 0;
        for (const id of ids) {
            const req = store.get(id);
            req.onsuccess = e => {
                const rec = e.target.result;
                if (rec) { rec.synced = true; store.put(rec); }
                if (++done === ids.length) resolve();
            };
            req.onerror = e => reject(e.target.error);
        }
    });
}

// ── FLUSH AL SERVIDOR ─────────────────────────────────────
async function flush(token) {
    if (!token) {
        postMessage({ type: 'sync_skip', reason: 'no_token' });
        return;
    }

    let pending;
    try {
        pending = await getPending();
    } catch (e) {
        postMessage({ type: 'sync_error', error: e.message });
        return;
    }

    if (!pending.length) {
        postMessage({ type: 'sync_ok', inserted: 0, duplicates: 0, queued: 0 });
        return;
    }

    try {
        const res = await fetch(BATCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                records: pending.map(r => ({
                    student_id: r.student_id,
                    timestamp: r.timestamp,
                    local_id: r.local_id
                }))
            })
        });

        if (!res.ok) {
            const err = await res.text();
            postMessage({ type: 'sync_error', error: `HTTP ${res.status}: ${err}` });
            return;
        }

        const data = await res.json();
        await markSynced(pending.map(r => r.local_id));

        postMessage({
            type: 'sync_ok',
            inserted: data.inserted || 0,
            duplicates: data.duplicates || 0,
            queued: 0
        });

    } catch (e) {
        // Sin conexión — no marcar como synced, reintentar luego
        postMessage({ type: 'sync_error', error: e.message });
    }
}

// ── ESTADO PENDIENTE ──────────────────────────────────────
async function countPending() {
    try {
        const pending = await getPending();
        postMessage({ type: 'queue_count', count: pending.length });
    } catch { }
}

// ── MENSAJE DEL HILO PRINCIPAL ────────────────────────────
let authToken = null;

self.addEventListener('message', async (e) => {
    const { type, record, token } = e.data;

    if (type === 'set_token') {
        authToken = token;
        return;
    }

    if (type === 'queue') {
        // Guardar en IndexedDB y notificar la cola
        try {
            await queueRecord(record);
            await countPending();
            // Intentar sincronizar de inmediato si hay conexión
            if (navigator.onLine && authToken) flush(authToken);
        } catch (err) {
            postMessage({ type: 'queue_error', error: err.message });
        }
        return;
    }

    if (type === 'flush') {
        await flush(authToken || token);
        await countPending();
        return;
    }

    if (type === 'count') {
        await countPending();
        return;
    }
});

// ── AUTO-FLUSH AL RECONECTAR ──────────────────────────────
self.addEventListener('online', () => { if (authToken) flush(authToken).then(countPending); });
self.addEventListener('offline', () => { postMessage({ type: 'offline' }); });

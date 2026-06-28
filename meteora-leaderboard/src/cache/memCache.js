const store = new Map();

export function get(key) {
  const entry = store.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return entry.value;
}

export function set(key, value, ttlMs) {
  const ttl = Number.parseInt(ttlMs, 10);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    return;
  }

  store.set(key, {
    value,
    expiresAt: Date.now() + ttl,
  });
}

export function del(key) {
  store.delete(key);
}

export function clear() {
  store.clear();
}

export function size() {
  return store.size;
}

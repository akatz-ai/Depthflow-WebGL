import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small';
const MODEL_CACHE_DB_NAME = 'depthflow-model-cache.v1';
const MODEL_CACHE_STORE = 'responses';
let modelCacheConfigured = false;

class PersistentModelCache {
    constructor(dbName = MODEL_CACHE_DB_NAME, storeName = MODEL_CACHE_STORE) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.dbPromise = null;
        this.browserCachePromise = null;
    }

    static requestToKey(request) {
        if (typeof request === 'string') return request;
        if (request instanceof URL) return request.toString();
        if (request && typeof request.url === 'string') return request.url;
        return String(request);
    }

    async getDb() {
        if (typeof indexedDB === 'undefined') return null;
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'key' });
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };

            request.onerror = () => {
                reject(request.error || new Error('Could not open model cache database'));
            };
        }).catch((err) => {
            this.dbPromise = null;
            console.warn('Model cache (IndexedDB) unavailable:', err);
            return null;
        });

        return this.dbPromise;
    }

    async getBrowserCache() {
        if (typeof caches === 'undefined') return null;
        if (this.browserCachePromise) return this.browserCachePromise;

        this.browserCachePromise = caches.open('transformers-cache').catch((err) => {
            this.browserCachePromise = null;
            console.warn('Model cache (CacheStorage) unavailable:', err);
            return null;
        });

        return this.browserCachePromise;
    }

    async readIndexedDb(key) {
        const db = await this.getDb();
        if (!db) return null;

        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const request = tx.objectStore(this.storeName).get(key);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error || new Error('Model cache read failed'));
            });
        } catch (err) {
            console.warn('Model cache read skipped:', err);
            return null;
        }
    }

    async writeIndexedDb(record) {
        const db = await this.getDb();
        if (!db) return false;

        try {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                tx.objectStore(this.storeName).put(record);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('Model cache write failed'));
                tx.onabort = () => reject(tx.error || new Error('Model cache write aborted'));
            });
            return true;
        } catch (err) {
            console.warn('Model cache write skipped:', err);
            return false;
        }
    }

    async match(request) {
        const key = PersistentModelCache.requestToKey(request);

        const record = await this.readIndexedDb(key);
        if (record && record.body) {
            return new Response(record.body, {
                status: record.status || 200,
                statusText: record.statusText || 'OK',
                headers: new Headers(record.headers || [])
            });
        }

        const browserCache = await this.getBrowserCache();
        if (!browserCache) return undefined;

        try {
            return await browserCache.match(key);
        } catch {
            return undefined;
        }
    }

    async put(request, response) {
        if (!(response instanceof Response)) return;
        const key = PersistentModelCache.requestToKey(request);

        let indexedDbStored = false;
        try {
            const dbResponse = response.clone();
            const body = await dbResponse.arrayBuffer();
            indexedDbStored = await this.writeIndexedDb({
                key,
                status: dbResponse.status,
                statusText: dbResponse.statusText,
                headers: Array.from(dbResponse.headers.entries()),
                body,
                updatedAt: Date.now()
            });
        } catch (err) {
            console.warn('Model cache serialization failed:', err);
        }

        const browserCache = await this.getBrowserCache();
        if (!browserCache) return;

        try {
            await browserCache.put(key, response.clone());
        } catch (err) {
            if (!indexedDbStored) {
                console.warn('Model cache fallback write failed:', err);
            }
        }
    }
}

export class DepthEstimator {
    constructor() {
        this.model = null;
        this.loading = false;
        this.configureModelCache();
    }

    configureModelCache() {
        if (modelCacheConfigured) return;
        modelCacheConfigured = true;

        env.useBrowserCache = true;

        // localStorage is too small for model binaries, so use IndexedDB-backed cache.
        if (typeof indexedDB !== 'undefined') {
            env.useCustomCache = true;
            env.customCache = new PersistentModelCache();
        }
    }

    isReady() {
        return Boolean(this.model);
    }

    async createDepthPipeline(device, onProgress) {
        return pipeline('depth-estimation', DEPTH_MODEL_ID, {
            device,
            progress_callback: onProgress
        });
    }

    async init(onProgress) {
        if (this.model || this.loading) return;
        this.loading = true;

        try {
            // Try WebGPU first — navigator.gpu may exist but adapter creation can still fail
            if (navigator.gpu) {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) {
                    this.model = await this.createDepthPipeline('webgpu', onProgress);
                    this.loading = false;
                    return;
                }
            }
        } catch (e) {
            console.warn('WebGPU init failed, falling back to WASM:', e.message);
        }

        // Fallback to WASM
        this.model = await this.createDepthPipeline('wasm', onProgress);

        this.loading = false;
    }

    async estimate(imageSource) {
        if (!this.model) throw new Error('Model not initialized');
        const result = await this.model(imageSource);
        return result.depth;
    }

    toImageData(depthImage) {
        const { width, height, data } = depthImage;
        const imageData = new ImageData(width, height);

        for (let i = 0; i < data.length; i++) {
            const val = data[i];
            imageData.data[i * 4] = val;
            imageData.data[i * 4 + 1] = val;
            imageData.data[i * 4 + 2] = val;
            imageData.data[i * 4 + 3] = 255;
        }

        return imageData;
    }
}

import { SecureStorageBase } from './base.js';
// oxlint-disable eslint/class-methods-use-this -- Protected methods don't use `this` but need to be overridden
export class SecureStorageWeb extends SecureStorageBase {
    // @native
    async setSynchronizeKeychain(_options) {
        // Web implementation - no-op
    }
    // @native
    // eslint-disable-next-line @typescript-eslint/require-await
    async internalGetItem(options) {
        return { data: localStorage.getItem(options.prefixedKey) };
    }
    // @native
    // eslint-disable-next-line @typescript-eslint/require-await
    async internalSetItem(options) {
        localStorage.setItem(options.prefixedKey, options.data);
    }
    // @native
    // eslint-disable-next-line @typescript-eslint/require-await
    async internalRemoveItem(options) {
        const item = localStorage.getItem(options.prefixedKey);
        if (item !== null) {
            localStorage.removeItem(options.prefixedKey);
            return { success: true };
        }
        return { success: false };
    }
    async clear() {
        const { keys } = await this.internalGetPrefixedKeys({ prefix: this.prefix });
        for (const key of keys) {
            localStorage.removeItem(key);
        }
    }
    // @native
    // eslint-disable-next-line @typescript-eslint/require-await
    async internalClearItemsWithPrefix(_options) {
        console.warn('internalClearItemsWithPrefix is native only');
    }
    // @native
    // eslint-disable-next-line @typescript-eslint/require-await
    async internalGetPrefixedKeys(options) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === null || key === void 0 ? void 0 : key.startsWith(options.prefix)) {
                keys.push(key);
            }
        }
        return { keys };
    }
}

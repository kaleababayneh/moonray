/**
 * In-memory private state provider (lumera pattern) with optional persistence
 * hooks so hosts can mirror state to durable storage (localStorage in the UI,
 * a JSON file in the CLI). Losing the secretKey or a run's nonce makes sealed
 * scores unrevealable — hosts should always wire the hooks.
 */

export interface PersistenceHooks<PS> {
  load?(key: string): PS | null;
  save?(key: string, state: PS | null): void;
}

export const createPrivateStateProvider = <PSI extends string = string, PS = unknown>(
  hooks: PersistenceHooks<PS> = {},
) => {
  const record = new Map<PSI, PS>();
  const signingKeys: Record<string, unknown> = {};
  const noop = () => Promise.resolve();

  return {
    setContractAddress(_address: string): void {
      // in-memory provider doesn't scope by contract address
    },
    set(key: PSI, state: PS): Promise<void> {
      record.set(key, state);
      hooks.save?.(key, state);
      return Promise.resolve();
    },
    get(key: PSI): Promise<PS | null> {
      if (!record.has(key)) {
        const loaded = hooks.load?.(key) ?? null;
        if (loaded !== null) record.set(key, loaded);
      }
      return Promise.resolve(record.get(key) ?? null);
    },
    remove(key: PSI): Promise<void> {
      record.delete(key);
      hooks.save?.(key, null);
      return Promise.resolve();
    },
    clear(): Promise<void> {
      record.clear();
      return Promise.resolve();
    },
    setSigningKey(contractAddress: string, signingKey: unknown): Promise<void> {
      signingKeys[contractAddress] = signingKey;
      return Promise.resolve();
    },
    getSigningKey(contractAddress: string): Promise<unknown> {
      return Promise.resolve(signingKeys[contractAddress] ?? null);
    },
    removeSigningKey(contractAddress: string): Promise<void> {
      delete signingKeys[contractAddress];
      return Promise.resolve();
    },
    clearSigningKeys(): Promise<void> {
      Object.keys(signingKeys).forEach((k) => delete signingKeys[k]);
      return Promise.resolve();
    },
    exportPrivateStates: noop as never,
    importPrivateStates: noop as never,
    exportSigningKeys: noop as never,
    importSigningKeys: noop as never,
  };
};

/**
 * Compiled-contract wiring (compact-js). `assetSource` is either the app
 * origin (browser: keys/zkir served from public/) or a filesystem path to
 * contract/src/managed/slicer (node).
 *
 * Construction is lazy per assetSource: building a CompiledContract at module
 * scope would make any compact-js failure kill the bundle on import.
 */

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract, type SlicerPrivateState, type Witnesses, witnesses } from '@moonray/contract';

const build = (assetSource: string) =>
  CompiledContract.make(
    'MoonraySlicer',
    Contract<SlicerPrivateState, Witnesses<SlicerPrivateState>>,
  ).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(assetSource),
  );

const cache = new Map<string, ReturnType<typeof build>>();

export function getCompiledSlicerContract(assetSource: string): ReturnType<typeof build> {
  let c = cache.get(assetSource);
  if (!c) {
    c = build(assetSource);
    cache.set(assetSource, c);
  }
  return c;
}

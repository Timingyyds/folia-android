import type { LocalLibraryAssignment, LocalLibraryEntity, LocalLibraryEntityKind } from '../types/localLibrary';
import Dexie from 'dexie';
import { appDatabase } from './appDatabase';

// src/svc/localLibraryEntityRepository.ts
// Exposes typed entity reads used by catalog transactions and local-library UI adapters.

export const getLocalLibraryEntities = async (kind?: LocalLibraryEntityKind): Promise<LocalLibraryEntity[]> => (
  kind
    ? await appDatabase.local_library_entities.where('kind').equals(kind).toArray()
    : await appDatabase.local_library_entities.toArray()
);

export const getLocalLibraryAssignments = async (): Promise<LocalLibraryAssignment[]> => (
  await appDatabase.local_library_assignments.toArray()
);

export const getLocalLibraryAssignment = async (songId: string): Promise<LocalLibraryAssignment | undefined> => (
  await appDatabase.local_library_assignments.get(songId)
);

type LocalLibraryCatalogSnapshot = {
  entities: LocalLibraryEntity[];
  assignments: LocalLibraryAssignment[];
};

const CATALOG_TABLE_NAMES = ['local_library_entities', 'local_library_assignments'] as const;
const catalogPartPrefixes = CATALOG_TABLE_NAMES.map(tableName => `idb://${appDatabase.name}/${tableName}/`);

// 进行中或已完成的目录快照读取；目录两张表任何一次写提交后清空。
let cachedCatalogSnapshot: Promise<LocalLibraryCatalogSnapshot> | null = null;

/** 丢弃缓存的目录快照，下一次读取重新访问 IndexedDB。 */
export const invalidateLocalLibraryCatalogSnapshot = (): void => {
  cachedCatalogSnapshot = null;
};

// storagemutated 在写事务提交后触发，覆盖 put / bulkPut / delete / clear，也覆盖 clearAllData 删库重建
// （重建时 Dexie 以全部表为范围触发一次）和其它标签页经 BroadcastChannel 传来的写入。
// 在提交后而不是写入时失效：写入时失效的话，提交前开始的读还会把旧数据重新放回缓存。
// 页面从 bfcache 恢复时 Dexie 发的是 { all }，不带表名，期间别的标签页可能写过目录，同样要失效。
Dexie.on('storagemutated', parts => {
  if ('all' in parts || Object.keys(parts).some(part => catalogPartPrefixes.some(prefix => part.startsWith(prefix)))) {
    invalidateLocalLibraryCatalogSnapshot();
  }
});

const readLocalLibraryCatalogSnapshot = (): Promise<LocalLibraryCatalogSnapshot> => appDatabase.transaction(
  'r',
  [appDatabase.local_library_entities, appDatabase.local_library_assignments],
  async () => ({
    entities: await appDatabase.local_library_entities.toArray(),
    assignments: await appDatabase.local_library_assignments.toArray(),
  }),
);

/**
 * Reads both entity tables in one transaction so consumers never combine different catalog revisions.
 *
 * 结果在目录表下一次写提交前一直复用：每次切本地歌都要读它，两张表随曲库线性增长，整表读放在出声前太贵。
 * 返回的数组和对象被所有调用方共享，只读使用，不要原地修改。
 * 在 Dexie 事务里调用时不走缓存：事务内自己的写还没提交，缓存看不到。
 */
export const getLocalLibraryCatalogSnapshot = async (): Promise<LocalLibraryCatalogSnapshot> => {
  if (Dexie.currentTransaction) return await readLocalLibraryCatalogSnapshot();
  if (cachedCatalogSnapshot) return await cachedCatalogSnapshot;

  const pending = readLocalLibraryCatalogSnapshot();
  cachedCatalogSnapshot = pending;
  // 读失败不缓存；读的过程中目录被写过时，上面的监听已经把 cachedCatalogSnapshot 清掉，这次结果只交给本次调用方。
  pending.catch(() => {
    if (cachedCatalogSnapshot === pending) cachedCatalogSnapshot = null;
  });
  return await pending;
};

export const resolveEntityRedirect = async (entityId: string): Promise<LocalLibraryEntity | undefined> => {
  const visited = new Set<string>();
  let entity = await appDatabase.local_library_entities.get(entityId);
  while (entity?.mergedInto && !visited.has(entity.id)) {
    visited.add(entity.id);
    entity = await appDatabase.local_library_entities.get(entity.mergedInto);
  }
  return entity;
};


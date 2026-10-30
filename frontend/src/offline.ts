import { openDB } from 'idb'

const dbPromise = openDB('gridguard-offline', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('complaint-drafts')) db.createObjectStore('complaint-drafts', { keyPath: 'localId' })
    if (!db.objectStoreNames.contains('inspection-drafts')) db.createObjectStore('inspection-drafts', { keyPath: 'localId' })
  },
})

export async function saveDraft(store: 'complaint-drafts' | 'inspection-drafts', data: Record<string, unknown>) {
  const item = { ...data, localId: crypto.randomUUID(), syncStatus: 'unsynced', savedAt: new Date().toISOString() }
  await (await dbPromise).put(store, item)
  return item
}

export async function getDrafts(store: 'complaint-drafts' | 'inspection-drafts') {
  return (await dbPromise).getAll(store)
}

export async function deleteDraft(store: 'complaint-drafts' | 'inspection-drafts', localId: string) {
  await (await dbPromise).delete(store, localId)
}

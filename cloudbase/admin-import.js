// Operator-only Event function. Never attach an HTTP gateway route.
exports.main = async (event, context) => {
  const crypto = require('node:crypto');
  const expected = process.env.MIGRATION_SECRET || '';
  const supplied = event?.migrationSecret || '';
  if (!/^[a-f0-9]{64}$/.test(expected) || typeof supplied !== 'string' ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    throw new Error('Migration authorization required');
  }
  if (event?.headers || event?.httpMethod || event?.requestContext) {
    throw new Error('HTTP invocation is forbidden');
  }

  const cloudbase = require('@cloudbase/node-sdk');
  const { POOL_ID, COLLECTION, snapshotToPool, validatePool, documentValue } = await import('./budget.mjs');
  const envId = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV || context?.namespace;
  if (!envId) throw new Error('Missing environment');
  const db = cloudbase.init({ env: envId }).database({ throwOnCode: true });
  let tx;
  try {
    tx = await db.startTransaction();
    const doc = tx.collection(COLLECTION).doc(POOL_ID);
    const existing = documentValue(await doc.get());

    if (event?.action === 'probe') {
      if (existing) throw new Error('Probe requires an empty target pool');
      const marker = crypto.randomUUID();
      const changed = await doc.set({ migrationProbe: marker });
      if (changed?.code || documentValue(await doc.get())?.migrationProbe !== marker) {
        throw new Error('Transaction probe readback failed');
      }
      await tx.rollback();
      tx = null;
      if (documentValue(await db.collection(COLLECTION).doc(POOL_ID).get())) {
        throw new Error('Transaction probe did not roll back');
      }
      return { transactionRollback: true, targetPoolAbsent: true };
    }

    if (event?.action === 'import') {
      if (existing) throw new Error('Budget already exists; never overwrite');
      const data = snapshotToPool(event.snapshot);
      const changed = await doc.set(data);
      if (changed?.code) throw new Error('Budget import failed');
      const readback = validatePool(documentValue(await doc.get()));
      if (readback.used !== data.used) throw new Error('Budget readback failed');
      await tx.commit();
      return { imported: true, used: data.used, remaining: 100 - data.used, paused: true };
    }

    if (event?.action === 'enable') {
      const pool = validatePool(existing);
      if (pool.disabled !== 1) throw new Error('Budget already enabled');
      const changed = await doc.update({ disabled: 0 });
      if (changed?.code || changed?.updated !== 1) throw new Error('Enable failed');
      await tx.commit();
      return { enabled: true, used: pool.used, remaining: 100 - pool.used };
    }
    throw new Error('Unknown action');
  } catch (error) {
    await tx?.rollback().catch(() => {});
    throw error;
  }
};

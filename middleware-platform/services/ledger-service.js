const db = require('../database');

class LedgerService {
  /**
   * Ensure a ledger account exists for an owner on a given rail.
   * @param {Object} options
   * @param {'patient'|'provider'|'insurer'|'system'} options.ownerType
   * @param {string} options.ownerId
   * @param {string} options.currency
   * @param {'stripe'|'circle'|'internal'} options.railType
   * @param {Object} [options.metadata]
   */
  static ensureAccount({ ownerType, ownerId, currency = 'USD', railType, metadata }) {
    return db.getOrCreateLedgerAccount(ownerType, ownerId, currency, railType, metadata);
  }

  /**
   * Post a single ledger entry (debit or credit).
   * @param {Object} entry
   * @returns {Object} inserted entry
   */
  static postEntry(entry) {
    if (!entry || !entry.account_id || !entry.currency) {
      throw new Error('ledger entry requires account_id and currency');
    }
    const debit = Number(entry.debit || 0);
    const credit = Number(entry.credit || 0);
    if (debit < 0 || credit < 0) {
      throw new Error('debit/credit must be non-negative');
    }
    if (debit === 0 && credit === 0) {
      throw new Error('either debit or credit must be non-zero');
    }
    return db.insertLedgerEntry({
      ...entry,
      debit,
      credit
    });
  }

  /**
   * Post a balanced transfer between two accounts.
   * @param {Object} params
   * @param {Object} params.fromAccount
   * @param {Object} params.toAccount
   * @param {number} params.amount
   * @param {string} params.currency
   * @param {string} params.externalRefType
   * @param {string} params.externalRefId
   * @param {string} [params.description]
   * @returns {{debitEntry:Object, creditEntry:Object}}
   */
  static transfer({ fromAccount, toAccount, amount, currency, externalRefType, externalRefId, description }) {
    const amt = Number(amount);
    if (!(amt > 0)) throw new Error('amount must be > 0');
    if (!fromAccount?.id || !toAccount?.id) {
      throw new Error('fromAccount and toAccount are required');
    }
    if (!currency) throw new Error('currency is required');

    const debitEntry = db.insertLedgerEntry({
      account_id: fromAccount.id,
      debit: amt,
      credit: 0,
      currency,
      external_ref_type: externalRefType,
      external_ref_id: externalRefId,
      description,
      status: 'pending'
    });

    const creditEntry = db.insertLedgerEntry({
      account_id: toAccount.id,
      debit: 0,
      credit: amt,
      currency,
      external_ref_type: externalRefType,
      external_ref_id: externalRefId,
      description,
      status: 'pending'
    });

    return { debitEntry, creditEntry };
  }

  /**
   * Mark all ledger entries for a given external reference as settled.
   * @param {string} externalRefType
   * @param {string} externalRefId
   */
  static settleByExternalRef(externalRefType, externalRefId) {
    const entries = db.getLedgerEntriesByRef(externalRefType, externalRefId);
    for (const e of entries) {
      db.markLedgerEntrySettled(e.id);
    }
    return entries.length;
  }
}

module.exports = LedgerService;


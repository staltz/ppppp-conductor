/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {ReturnType<import('ppppp-goals').init>} PPPPPGoal
 * @typedef {ReturnType<import('ppppp-set').init>} PPPPPSet
 * @typedef {ReturnType<import('ppppp-sync').init>} PPPPPSync
 * @typedef {ReturnType<import('ppppp-gc').init>} PPPPPGC
 * @typedef {[Array<string>, Array<string>]} Rules
 * @typedef {{
 *   db:PPPPPDB | null,
 *   goals: PPPPPGoal | null,
 *   set: PPPPPSet | null,
 *   sync: PPPPPSync | null,
 *   gc: PPPPPGC | null,
 * }} UnknownPeer
 */

/**
 * @param {{ db: PPPPPDB | null }} peer
 * @returns {asserts peer is { db: PPPPPDB }}
 */
function assertDBPlugin(peer) {
  if (!peer.db) throw new Error('conductor plugin needs ppppp-db plugin')
}

/**
 * @param {{ goals: PPPPPGoal | null }} peer
 * @returns {asserts peer is { goals: PPPPPGoal }}
 */
function assertGoalsPlugin(peer) {
  if (!peer.goals) throw new Error('conductor plugin needs ppppp-goals plugin')
}

/**
 * @param {{ set: PPPPPSet | null }} peer
 * @returns {asserts peer is { set: PPPPPSet }}
 */
function assertSetPlugin(peer) {
  if (!peer.set) throw new Error('conductor plugin needs ppppp-set plugin')
}

/**
 * @param {{ gc: PPPPPGC | null }} peer
 * @returns {asserts peer is { gc: PPPPPGC }}
 */
function assertGCPlugin(peer) {
  if (!peer.gc) throw new Error('conductor plugin needs ppppp-gc plugin')
}

/**
 * @param {{ sync: PPPPPSync | null }} peer
 * @returns {asserts peer is { sync: PPPPPSync }}
 */
function assertSyncPlugin(peer) {
  if (!peer.sync) throw new Error('conductor plugin needs ppppp-sync plugin')
}

/**
 * @param {UnknownPeer} peer
 * @param {unknown} config
 */
function initConductor(peer, config) {
  assertDBPlugin(peer)
  assertGoalsPlugin(peer)
  assertSetPlugin(peer)
  assertGCPlugin(peer)
  assertSyncPlugin(peer)

  /**
   * Set replication goals for various tangles of an account:
   * - Account tangle
   * - Follow tangle (a Set)
   * - Each tangle in the rule
   *
   * The "rule" is just a list of domains of feeds.
   * @param {string} accountID
   * @param {Array<string>} rule
   */
  function setupAccountGoals(accountID, rule) {
    assertDBPlugin(peer)
    assertSetPlugin(peer)
    assertGoalsPlugin(peer)

    peer.goals.set(accountID, 'all')

    const followDomain = peer.set.getDomain('follow')
    const followFeedID = peer.db.feed.getID(accountID, followDomain)
    peer.goals.set(followFeedID, 'set')

    for (const domain of rule) {
      const feedID = peer.db.feed.getID(accountID, domain)
      peer.goals.set(feedID, 'all') // TODO better goal?
    }
  }

  /**
   * Starts automatic sync and garbage collection.
   * Assumes that PPPPP Set has been loaded with the same accountID.
   *
   * @param {string} myID
   * @param {Rules} rules
   * @param {number} maxBytes
   */
  function start(myID, rules, maxBytes) {
    assertDBPlugin(peer)
    assertSetPlugin(peer)
    assertGoalsPlugin(peer)
    assertGCPlugin(peer)
    assertSyncPlugin(peer)

    const [myRule, theirRule] = rules

    // TODO: Figure out goals for each tangle, and sizes according to maxLogBytes
    // TODO: Figure out ghost spans for dicts and sets

    setupAccountGoals(myID, myRule)

    // TODO: watch the set for live updates, on add, syncAccount()
    // TODO: watch the set for live updates, on remove, forgetAccount()
    const followedAccounts = peer.set.values('follow')
    for (const theirID of followedAccounts) {
      setupAccountGoals(theirID, theirRule)
    }

    peer.gc.start(maxBytes)
    peer.sync.start()
  }

  return {
    start,
  }
}

exports.name = 'conductor'
exports.init = initConductor

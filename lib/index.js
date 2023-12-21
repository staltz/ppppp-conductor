const makeDebug = require('debug')

/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {ReturnType<import('ppppp-goals').init>} PPPPPGoal
 * @typedef {import('ppppp-goals').GoalDSL} GoalDSL
 * @typedef {ReturnType<import('ppppp-set').init>} PPPPPSet
 * @typedef {ReturnType<import('ppppp-sync').init>} PPPPPSync
 * @typedef {ReturnType<import('ppppp-gc').init>} PPPPPGC
 * @typedef {`${string}@${GoalDSL}`} Rule
 * @typedef {[Array<Rule>, Array<Rule>]} Rules
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
 * @param {any} rule
 * @returns {[string, GoalDSL]}
 */
function parseRule(rule) {
  if (typeof rule !== 'string') throw new Error('rule must be a string')
  if (!rule) throw new Error('rule must not be empty')
  if (!rule.includes('@')) throw new Error('rule fit the format "domain@goal"')
  const splitted = /**@type {[string, GoalDSL]}*/ (rule.split('@'))
  if (!splitted[0]) throw new Error('rule must fit the format "domain@goal"')
  if (!splitted[1]) throw new Error('rule must fit the format "domain@goal"')
  return splitted
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

  const debug = makeDebug('ppppp:conductor')

  /**
   * Set replication goals for various tangles of an account:
   * - Account tangle
   * - Follow tangle (a Set)
   * - Each tangle in the rule
   *
   * The "rule" is just a list of domains of feeds.
   * @param {string} accountID ID of the account to set goals for
   * @param {Array<Rule>} rules list of feed domains of interest
   */
  function setupAccountGoals(accountID, rules) {
    assertDBPlugin(peer)
    assertSetPlugin(peer)
    assertGoalsPlugin(peer)

    peer.goals.set(accountID, 'all')

    const followDomain = peer.set.getDomain('follow')
    const followFeedID = peer.db.feed.getID(accountID, followDomain)
    peer.goals.set(followFeedID, 'set')

    const blockDomain = peer.set.getDomain('block')
    const blockFeedID = peer.db.feed.getID(accountID, blockDomain)
    peer.goals.set(blockFeedID, 'set')

    for (const rule of rules) {
      const [domain, goalDSL] = parseRule(rule)
      const feedID = peer.db.feed.getID(accountID, domain)
      peer.goals.set(feedID, goalDSL)
    }

    // prettier-ignore
    debug('Setup goals for %s@all, %s@set, %s@set, %s', accountID, followDomain, blockDomain, rules.join(', '))
  }

  /**
   * @param {string} accountID
   * @param {Array<string>} rules
   */
  function teardownAccountGoals(accountID, rules) {
    assertDBPlugin(peer)
    assertSetPlugin(peer)
    assertGoalsPlugin(peer)

    peer.goals.set(accountID, 'none')

    const followDomain = peer.set.getDomain('follow')
    const followFeedID = peer.db.feed.getID(accountID, followDomain)
    peer.goals.set(followFeedID, 'none')

    const blockDomain = peer.set.getDomain('block')
    const blockFeedID = peer.db.feed.getID(accountID, blockDomain)
    peer.goals.set(blockFeedID, 'none')

    for (const rule of rules) {
      const [domain] = parseRule(rule)
      const feedID = peer.db.feed.getID(accountID, domain)
      peer.goals.set(feedID, 'none')
    }

    // prettier-ignore
    debug('Teardown goals for %s@all, %s@set, %s@set, %s', accountID, followDomain, blockDomain, rules.join(', '))
  }

  /**
   * Starts automatic sync and garbage collection.
   * Assumes that PPPPP Set has been loaded with the same accountID.
   *
   * @param {string} myID
   * @param {[Array<Rule>, Array<Rule>]} rules
   * @param {number} maxBytes
   */
  function start(myID, rules, maxBytes) {
    assertDBPlugin(peer)
    assertSetPlugin(peer)
    assertGoalsPlugin(peer)
    assertGCPlugin(peer)
    assertSyncPlugin(peer)

    const [myRules, theirRules] = rules

    // TODO: If goals are too big for maxBytes budget, scale down goals
    // TODO: Figure out ghost spans for dicts and sets

    setupAccountGoals(myID, myRules)

    const followedAccounts = peer.set.values('follow')
    for (const theirID of followedAccounts) {
      setupAccountGoals(theirID, theirRules)
    }
    // @ts-ignore
    peer.set.watch(({ event, subdomain, value }) => {
      const theirID = value
      if (subdomain === 'follow' && event === 'add') {
        setupAccountGoals(theirID, theirRules)
      }
      if (subdomain === 'follow' && event === 'del') {
        teardownAccountGoals(theirID, theirRules)
      }
      if (subdomain === 'block' && event === 'add') {
        teardownAccountGoals(theirID, theirRules)
      }
    })

    peer.gc.start(maxBytes)
    peer.sync.start()
  }

  return {
    start,
  }
}

exports.name = 'conductor'
exports.init = initConductor

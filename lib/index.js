const makeDebug = require('debug')
const MsgV4 = require('ppppp-db/msg-v4')

/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {ReturnType<import('ppppp-goals').init>} PPPPPGoal
 * @typedef {import('ppppp-goals').GoalDSL} GoalDSL
 * @typedef {ReturnType<import('ppppp-set').init>} PPPPPSet
 * @typedef {ReturnType<import('ppppp-dict').init>} PPPPPDict
 * @typedef {ReturnType<import('ppppp-sync').init>} PPPPPSync
 * @typedef {ReturnType<import('ppppp-gc').init>} PPPPPGC
 * @typedef {`${string}@${GoalDSL}`} Rule
 * @typedef {[Array<Rule>, Array<Rule>]} Rules
 * @typedef {{
 *   db: PPPPPDB | null,
 *   goals: PPPPPGoal | null,
 *   set: PPPPPSet | null,
 *   dict: PPPPPDict | null,
 *   sync: PPPPPSync | null,
 *   gc: PPPPPGC | null,
 * }} UnknownPeer
 */

/**
 * @param {{ db: PPPPPDB | null }} peer
 * @returns {asserts peer is { db: PPPPPDB }}
 */
function assertDBPlugin(peer) {
  if (!peer.db) throw new Error('"conductor" plugin requires "db" plugin')
}

/**
 * @param {{ goals: PPPPPGoal | null }} peer
 * @returns {asserts peer is { goals: PPPPPGoal }}
 */
function assertGoalsPlugin(peer) {
  if (!peer.goals) throw new Error('"conductor" plugin requires "goals" plugin')
}

/**
 * @param {{ set: PPPPPSet | null }} peer
 * @returns {asserts peer is { set: PPPPPSet }}
 */
function assertSetPlugin(peer) {
  if (!peer.set) throw new Error('"conductor" plugin requires "set" plugin')
}

/**
 * @param {{ gc: PPPPPGC | null }} peer
 * @returns {asserts peer is { gc: PPPPPGC }}
 */
function assertGCPlugin(peer) {
  if (!peer.gc) throw new Error('"conductor" plugin requires "gc" plugin')
}

/**
 * @param {{ sync: PPPPPSync | null }} peer
 * @returns {asserts peer is { sync: PPPPPSync }}
 */
function assertSyncPlugin(peer) {
  if (!peer.sync) throw new Error('"conductor" plugin requires "sync" plugin')
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

  /**
   * How many bytes does a single msg ID take up
   */
  const MSG_ID_BYTES = MsgV4.getMootID('dummy', 'dummy').length

  /**
   * How many bytes does an average msg take up
   */
  const ESTIMATE_MSG_SIZE = 600 // 600 bytes

  /**
   * How many bytes should we budget for ghost msg IDs in total in the database
   */
  const ESTIMATE_TOTAL_GHOST_BYTES = 1024 * 1024 // 1 MB

  /**
   * How many msgs does the average 'follow' Set feed contain
   */
  const ESTIMATE_FOLLOW_FEED_SIZE = 300

  /**
   * How many msgs does the average 'block' Set feed contain
   */
  const ESTIMATE_BLOCK_FEED_SIZE = 30

  /**
   * How many msgs does the average unknown feed contain
   */
  const ESTIMATE_FEED_SIZE = 100

  const MIN_MAXBYTES = 1024 // 1 kB
  const MIN_RECOMMENDED_MAXBYTES = 32 * 1024 * 1024 // 32 MB
  const GOOD_RECOMMENDED_MAXBYTES = 64 * 1024 * 1024 // 64 MB
  const MAX_RECOMMENDED_MAXBYTES = 100 * 1024 * 1024 // 100 MB

  const debug = makeDebug('ppppp:conductor')

  /**
   * @param {Array<Rule>} rules
   */
  function countGhostableFeeds(rules) {
    let count = 2 // 'follow' and 'block' Sets
    for (const rule of rules) {
      const [, goalDSL] = parseRule(rule)
      if (goalDSL === 'dict') count++
      else if (goalDSL === 'set') count++
    }
    return count
  }

  /**
   * @param {Rule} rule
   */
  function getRealisticCount(rule) {
    assertGoalsPlugin(peer)
    const [, goalDSL] = parseRule(rule)
    const { count } = peer.goals.parse(goalDSL)
    const realisticCount = isFinite(count)
      ? count
      : Math.min(count, ESTIMATE_FEED_SIZE)
    return realisticCount
  }

  /**
   * Parses input rules. If goals are too big for maxBytes budget, scale down
   * goals.
   *
   * @param {[Array<Rule>, Array<Rule>]} rules
   * @param {number} numFollowed
   * @param {number} maxBytes
   * @returns {[Array<Rule>, Array<Rule>]}
   */
  function validateRules(rules, numFollowed, maxBytes) {
    assertGoalsPlugin(peer)

    const [myRules, theirRules] = rules

    let estimateMsgCount =
      (1 + numFollowed) * ESTIMATE_FOLLOW_FEED_SIZE + ESTIMATE_BLOCK_FEED_SIZE
    for (const rule of myRules) {
      estimateMsgCount += getRealisticCount(rule)
    }
    for (const rule of theirRules) {
      estimateMsgCount += numFollowed * getRealisticCount(rule)
    }

    const estimateBytesUsed = estimateMsgCount * ESTIMATE_MSG_SIZE
    const factor = maxBytes / estimateBytesUsed
    if (estimateBytesUsed > maxBytes) {
      if (maxBytes < MIN_RECOMMENDED_MAXBYTES) {
        // prettier-ignore
        debug('WARNING. maxBytes is in practice too small, we recommend at least %s bytes, ideally %s bytes, and at most %s bytes', MIN_RECOMMENDED_MAXBYTES, GOOD_RECOMMENDED_MAXBYTES, MAX_RECOMMENDED_MAXBYTES)
      } else {
        // prettier-ignore
        debug('WARNING. maxBytes might be easily surpassed, you should downscale rules to %s%', (factor*100).toFixed(0))
      }
    }

    return [myRules, theirRules]
  }

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

    if (maxBytes < MIN_MAXBYTES) {
      // prettier-ignore
      throw new Error(`ppppp-conductor maxBytes must be at least ${MIN_MAXBYTES} bytes, got ${maxBytes}`)
    }
    if (maxBytes > MAX_RECOMMENDED_MAXBYTES) {
      debug('WARNING. maxBytes is too big, we recommend at most %s bytes', MAX_RECOMMENDED_MAXBYTES)
    }

    const followedAccounts = peer.set.values('follow')
    const numFollowed = followedAccounts.length
    const [myRules, theirRules] = validateRules(rules, numFollowed, maxBytes)

    // Set up goals for my account and each account I follow
    setupAccountGoals(myID, myRules)
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

    // Figure out ghost span for each account
    const totalGhostableFeeds =
      countGhostableFeeds(myRules) +
      numFollowed * countGhostableFeeds(theirRules)
    const TOTAL_GHOSTS = ESTIMATE_TOTAL_GHOST_BYTES / MSG_ID_BYTES
    const ghostSpan = Math.round(TOTAL_GHOSTS / totalGhostableFeeds)
    peer.set.setGhostSpan(ghostSpan)
    peer.dict?.setGhostSpan(ghostSpan)

    // Kick off garbage collection and synchronization
    peer.gc.start(maxBytes)
    peer.sync.start()
  }

  return {
    start,
  }
}

exports.name = 'conductor'
exports.init = initConductor

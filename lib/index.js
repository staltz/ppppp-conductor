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
 *   db: PPPPPDB,
 *   goals: PPPPPGoal,
 *   set: PPPPPSet,
 *   sync: PPPPPSync,
 *   gc: PPPPPGC,
 *   dict: PPPPPDict | null,
 * }} Peer
 */

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
 * @param {Peer} peer
 * @param {unknown} config
 */
function initConductor(peer, config) {
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
   * How many msgs does the average 'follows' Set feed contain
   */
  const ESTIMATE_FOLLOWS_FEED_SIZE = 300
  /**
   * How many msgs does the average 'block' Set feed contain
   */
  const ESTIMATE_BLOCK_FEED_SIZE = 30
  /**
   * How many msgs does the average unknown feed contain
   */
  const ESTIMATE_FEED_SIZE = 100
  /**
   * Absolute minimum acceptable maxBytes parameter
   */
  const MIN_MAXBYTES = 1024 // 1 kB
  /**
   * Lower bound for somewhat acceptable maxBytes parameter
   */
  const MIN_DECENT_MAXBYTES = 32 * 1024 * 1024 // 32 MB
  /**
   * Recommended maxBytes parameter
   */
  const RECOMMENDED_MAXBYTES = 64 * 1024 * 1024 // 64 MB
  /**
   * Upper bound for somewhat acceptable maxBytes parameter
   */
  const MAX_DECENT_MAXBYTES = 100 * 1024 * 1024 // 100 MB

  const debug = makeDebug('ppppp:conductor')

  /**
   * @param {Array<Rule>} rules
   */
  function countGhostableFeeds(rules) {
    let count = 2 // 'follows' and 'blocks' Sets
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
    const [myRules, theirRules] = rules

    let estimateMsgCount =
      (1 + numFollowed) * ESTIMATE_FOLLOWS_FEED_SIZE + ESTIMATE_BLOCK_FEED_SIZE
    for (const rule of myRules) {
      estimateMsgCount += getRealisticCount(rule)
    }
    for (const rule of theirRules) {
      estimateMsgCount += numFollowed * getRealisticCount(rule)
    }

    const estimateBytesUsed = estimateMsgCount * ESTIMATE_MSG_SIZE
    const factor = maxBytes / estimateBytesUsed
    if (estimateBytesUsed > maxBytes) {
      if (maxBytes < MIN_DECENT_MAXBYTES) {
        // prettier-ignore
        debug('WARNING. maxBytes is in practice too small, we recommend at least %s bytes, ideally %s bytes, and at most %s bytes', MIN_DECENT_MAXBYTES, RECOMMENDED_MAXBYTES, MAX_DECENT_MAXBYTES)
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
    peer.goals.set(accountID, 'all')

    const followsDomain = peer.set.getDomain('follows')
    const followsFeedID = peer.db.feed.getID(accountID, followsDomain)
    peer.goals.set(followsFeedID, 'set')

    const blocksDomain = peer.set.getDomain('blocks')
    const blocksFeedID = peer.db.feed.getID(accountID, blocksDomain)
    peer.goals.set(blocksFeedID, 'set')

    for (const rule of rules) {
      const [domain, goalDSL] = parseRule(rule)
      const feedID = peer.db.feed.getID(accountID, domain)
      peer.goals.set(feedID, goalDSL)
    }

    // prettier-ignore
    debug('Setup goals for %s@all, %s@set, %s@set, %s', accountID, followsDomain, blocksDomain, rules.join(', '))
  }

  /**
   * @param {string} accountID
   * @param {Array<string>} rules
   */
  function teardownAccountGoals(accountID, rules) {
    peer.goals.set(accountID, 'none')

    const followsDomain = peer.set.getDomain('follows')
    const followsFeedID = peer.db.feed.getID(accountID, followsDomain)
    peer.goals.set(followsFeedID, 'none')

    const blocksDomain = peer.set.getDomain('blocks')
    const blocksFeedID = peer.db.feed.getID(accountID, blocksDomain)
    peer.goals.set(blocksFeedID, 'none')

    for (const rule of rules) {
      const [domain] = parseRule(rule)
      const feedID = peer.db.feed.getID(accountID, domain)
      peer.goals.set(feedID, 'none')
    }

    // prettier-ignore
    debug('Teardown goals for %s@all, %s@set, %s@set, %s', accountID, followsDomain, blocksDomain, rules.join(', '))
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
    if (maxBytes < MIN_MAXBYTES) {
      // prettier-ignore
      throw new Error(`ppppp-conductor maxBytes must be at least ${MIN_MAXBYTES} bytes, got ${maxBytes}`)
    }
    if (maxBytes > MAX_DECENT_MAXBYTES) {
      // prettier-ignore
      debug('WARNING. maxBytes is too big, we recommend at most %s bytes', MAX_DECENT_MAXBYTES)
    }

    const follows = peer.set.values('follows')
    const numFollows = follows.length
    const [myRules, theirRules] = validateRules(rules, numFollows, maxBytes)

    // Set up goals for my account and each account I follow
    setupAccountGoals(myID, myRules)
    for (const theirID of follows) {
      setupAccountGoals(theirID, theirRules)
    }
    // @ts-ignore
    peer.set.watch(({ event, subdomain, value }) => {
      const theirID = value
      if (subdomain === 'follows' && event === 'add') {
        setupAccountGoals(theirID, theirRules)
      }
      if (subdomain === 'follows' && event === 'del') {
        teardownAccountGoals(theirID, theirRules)
      }
      if (subdomain === 'blocks' && event === 'add') {
        teardownAccountGoals(theirID, theirRules)
      }
    })

    // Figure out ghost span for each account
    const totalGhostableFeeds =
      countGhostableFeeds(myRules) +
      numFollows * countGhostableFeeds(theirRules)
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
exports.needs = ['db', 'goals', 'set', 'gc', 'sync']
exports.init = initConductor

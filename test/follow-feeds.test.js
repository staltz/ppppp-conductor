const test = require('node:test')
const assert = require('node:assert')
const p = require('node:util').promisify
const { createPeer } = require('./util')

function getTexts(msgs) {
  return msgs.filter((msg) => msg.data?.text).map((msg) => msg.data.text)
}

test('Sets goals according to input rules', async (t) => {
  // Alice
  const alice = createPeer({ name: 'alice' })
  await alice.db.loaded()
  // Alice creates her own account
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  await p(alice.set.load)(aliceID)

  alice.conductor.start(
    aliceID,
    [['posts@newest-100', 'hubs@set', 'profile@dict']],
    64_000_000
  )

  const goals = [...alice.goals.list()]
  assert.equal(goals.length, 6, 'alice has 6 goals')

  assert.equal(goals[0].type, 'all')
  assert.equal(goals[0].id, aliceID)

  assert.equal(goals[1].type, 'set')
  assert.equal(goals[1].id, alice.db.feed.getID(aliceID, alice.set.getDomain('follows')))

  assert.equal(goals[2].type, 'set')
  assert.equal(goals[2].id, alice.db.feed.getID(aliceID, alice.set.getDomain('blocks')))

  assert.equal(goals[3].type, 'newest')
  assert.equal(goals[3].count, 100)
  assert.equal(goals[3].id, alice.db.feed.getID(aliceID, 'posts'))

  assert.equal(goals[4].type, 'set')
  assert.equal(goals[4].id, alice.db.feed.getID(aliceID, alice.set.getDomain('hubs')))

  assert.equal(goals[5].type, 'dict')
  assert.equal(goals[5].id, alice.db.feed.getID(aliceID, alice.dict.getDomain('profile')))

  await p(alice.close)(true)
})

test('Replicate selected feeds of followed accounts', async (t) => {
  // Alice
  const alice = createPeer({ name: 'alice' })
  await alice.db.loaded()
  // Alice creates her own account
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  await p(alice.set.load)(aliceID)
  // Alice creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(alice.db.feed.publish)({
      account: aliceID,
      domain: 'post',
      data: { text: 'A' + i },
    })
  }

  // Bob
  const bob = createPeer({ name: 'bob' })
  await bob.db.loaded()
  // Bob creates his own account
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  await p(bob.set.load)(bobID)
  // Bob creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(bob.db.feed.publish)({
      account: bobID,
      domain: 'post',
      data: { text: 'B' + i },
    })
  }

  // Carol
  const carol = createPeer({ name: 'carol' })
  await carol.db.loaded()
  // Carol creates her own account
  const carolID = await p(carol.db.account.create)({
    subdomain: 'account',
    _nonce: 'carol',
  })
  await p(carol.set.load)(bobID)
  // Carol creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(carol.db.feed.publish)({
      account: carolID,
      domain: 'post',
      data: { text: 'C' + i },
    })
  }

  // Alice follows Bob, but not Carol
  assert(await p(alice.set.add)('follows', bobID), 'alice follows bob')

  alice.conductor.start(aliceID, [['post@all'], ['post@all']], 64_000_000)
  bob.conductor.start(bobID, [['post@all'], ['post@all']], 64_000_000)

  const aliceDialingBob = await p(alice.connect)(bob.getAddress())
  const aliceDialingCarol = await p(alice.connect)(carol.getAddress())
  await p(setTimeout)(1000)

  assert.deepEqual(
    getTexts([...alice.db.msgs()]),
    ['A0', 'A1', 'A2', 'A3', 'A4', /*          */ 'B0', 'B1', 'B2', 'B3', 'B4'],
    'alice has alice and bob posts'
  )

  await p(aliceDialingBob.close)(true)
  await p(aliceDialingCarol.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
  await p(carol.close)(true)
})

test('GC selected feeds of followed accounts', async (t) => {
  // Alice
  const alice = createPeer({ name: 'alice' })
  await alice.db.loaded()
  // Alice creates her own account
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  await p(alice.set.load)(aliceID)
  // Alice creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(alice.db.feed.publish)({
      account: aliceID,
      domain: 'post',
      data: { text: 'A' + i },
    })
  }

  // Bob
  const bob = createPeer({ name: 'bob' })
  await bob.db.loaded()
  // Bob creates his own account
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  await p(bob.set.load)(bobID)
  // Bob creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(bob.db.feed.publish)({
      account: bobID,
      domain: 'post',
      data: { text: 'B' + i },
    })
  }

  // Carol
  const carol = createPeer({ name: 'carol' })
  await carol.db.loaded()
  // Carol creates her own account
  const carolID = await p(carol.db.account.create)({
    subdomain: 'account',
    _nonce: 'carol',
  })
  await p(carol.set.load)(bobID)
  // Carol creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(carol.db.feed.publish)({
      account: carolID,
      domain: 'post',
      data: { text: 'C' + i },
    })
  }

  // Alice follows Bob, but not Carol
  assert(await p(alice.set.add)('follows', bobID), 'alice follows bob')

  alice.conductor.start(aliceID, [['post@all'], ['post@all']], 64_000_000)
  bob.conductor.start(bobID, [['post@all'], ['post@all']], 64_000_000)

  const aliceDialingBob = await p(alice.connect)(bob.getAddress())
  const aliceDialingCarol = await p(alice.connect)(carol.getAddress())
  await p(setTimeout)(1000)

  assert.deepEqual(
    getTexts([...alice.db.msgs()]),
    ['A0', 'A1', 'A2', 'A3', 'A4', /*          */ 'B0', 'B1', 'B2', 'B3', 'B4'],
    'alice has alice and bob posts'
  )

  await p(aliceDialingBob.close)(true)
  await p(aliceDialingCarol.close)(true)

  alice.conductor.start(aliceID, [['post@all'], ['post@newest-2']], 8_000)
  const aliceDialingBob2 = await p(alice.connect)(bob.getAddress())
  const aliceDialingCarol2 = await p(alice.connect)(carol.getAddress())
  await p(setTimeout)(1000)

  assert.deepEqual(
    getTexts([...alice.db.msgs()]),
    ['A0', 'A1', 'A2', 'A3', 'A4', /*                           */ 'B3', 'B4'],
    'alice has alice and bob posts'
  )

  await p(aliceDialingBob2.close)(true)
  await p(aliceDialingCarol2.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
  await p(carol.close)(true)
})

test('GC recently-unfollowed accounts', async (t) => {
  // Alice
  const alice = createPeer({ name: 'alice' })
  await alice.db.loaded()
  // Alice creates her own account
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  await p(alice.set.load)(aliceID)
  // Alice creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(alice.db.feed.publish)({
      account: aliceID,
      domain: 'post',
      data: { text: 'A' + i },
    })
  }

  // Bob
  const bob = createPeer({ name: 'bob' })
  await bob.db.loaded()
  // Bob creates his own account
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  await p(bob.set.load)(bobID)
  // Bob creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(bob.db.feed.publish)({
      account: bobID,
      domain: 'post',
      data: { text: 'B' + i },
    })
  }

  // Carol
  const carol = createPeer({ name: 'carol' })
  await carol.db.loaded()
  // Carol creates her own account
  const carolID = await p(carol.db.account.create)({
    subdomain: 'account',
    _nonce: 'carol',
  })
  await p(carol.set.load)(carolID)
  // Carol creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(carol.db.feed.publish)({
      account: carolID,
      domain: 'post',
      data: { text: 'C' + i },
    })
  }

  // Alice follows Bob, but not Carol
  assert(await p(alice.set.add)('follows', bobID), 'alice follows bob')

  alice.conductor.start(aliceID, [['post@all'], ['post@all']], 4_000)
  bob.conductor.start(bobID, [['post@all'], ['post@all']], 4_000)

  const aliceDialingBob = await p(alice.connect)(bob.getAddress())
  const aliceDialingCarol = await p(alice.connect)(carol.getAddress())
  await p(setTimeout)(2000)

  assert.deepEqual(
    getTexts([...alice.db.msgs()]),
    ['A0', 'A1', 'A2', 'A3', 'A4', /*          */ 'B0', 'B1', 'B2', 'B3', 'B4'],
    'alice has alice and bob posts'
  )

  assert(await p(alice.set.del)('follows', bobID), 'alice unfollows bob')
  await p(setTimeout)(1000)

  assert.deepEqual(
    getTexts([...alice.db.msgs()]),
    ['A0', 'A1', 'A2', 'A3', 'A4'],
    'alice has alice posts'
  )

  await p(aliceDialingBob.close)(true)
  await p(aliceDialingCarol.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
  await p(carol.close)(true)
})

test('GC recently-blocked accounts', async (t) => {
  // Alice
  const alice = createPeer({ name: 'alice' })
  await alice.db.loaded()
  // Alice creates her own account
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  await p(alice.set.load)(aliceID)
  // Alice creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(alice.db.feed.publish)({
      account: aliceID,
      domain: 'post',
      data: { text: 'A' + i },
    })
  }

  // Bob
  const bob = createPeer({ name: 'bob' })
  await bob.db.loaded()
  // Bob creates his own account
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  await p(bob.set.load)(bobID)
  // Bob creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(bob.db.feed.publish)({
      account: bobID,
      domain: 'post',
      data: { text: 'B' + i },
    })
  }

  // Carol
  const carol = createPeer({ name: 'carol' })
  await carol.db.loaded()
  // Carol creates her own account
  const carolID = await p(carol.db.account.create)({
    subdomain: 'account',
    _nonce: 'carol',
  })
  await p(carol.set.load)(bobID)
  // Carol creates a feed of posts
  for (let i = 0; i < 5; i++) {
    await p(carol.db.feed.publish)({
      account: carolID,
      domain: 'post',
      data: { text: 'C' + i },
    })
  }

  // Alice follows Bob, but not Carol
  assert(await p(alice.set.add)('follows', bobID), 'alice follows bob')

  alice.conductor.start(aliceID, [['post@all'], ['post@all']], 4_000)
  bob.conductor.start(bobID, [['post@all'], ['post@all']], 4_000)

  const aliceDialingBob = await p(alice.connect)(bob.getAddress())
  const aliceDialingCarol = await p(alice.connect)(carol.getAddress())
  await p(setTimeout)(2000)

  assert.deepEqual(
    getTexts([...alice.db.msgs()]),
    ['A0', 'A1', 'A2', 'A3', 'A4', /*          */ 'B0', 'B1', 'B2', 'B3', 'B4'],
    'alice has alice and bob posts'
  )

  assert(await p(alice.set.add)('blocks', bobID), 'alice blocks bob')
  await p(setTimeout)(1000)

  assert.deepEqual(
    getTexts([...alice.db.msgs()]),
    ['A0', 'A1', 'A2', 'A3', 'A4'],
    'alice has alice posts'
  )

  await p(aliceDialingBob.close)(true)
  await p(aliceDialingCarol.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
  await p(carol.close)(true)
})

test('Set and Dict ghost spans', async (t) => {
  // Alice
  const alice = createPeer({ name: 'alice' })
  await alice.db.loaded()
  // Alice creates her own account
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  await p(alice.set.load)(aliceID)

  // Bob
  const bob = createPeer({ name: 'bob' })
  await bob.db.loaded()
  // Bob creates his own account
  const bobID = await p(bob.db.account.create)({
    subdomain: 'account',
    _nonce: 'bob',
  })
  await p(bob.set.load)(bobID)

  // Carol
  const carol = createPeer({ name: 'carol' })
  await carol.db.loaded()
  // Carol creates her own account
  const carolID = await p(carol.db.account.create)({
    subdomain: 'account',
    _nonce: 'carol',
  })
  await p(carol.set.load)(bobID)

  // Alice follows Bob, but not Carol
  assert(await p(alice.set.add)('follows', bobID), 'alice follows bob')

  alice.conductor.start(aliceID, [['post@all'], ['post@all']], 4_000)
  bob.conductor.start(bobID, [['post@all'], ['post@all']], 4_000)

  assert.equal(alice.set.getGhostSpan(), 5958, 'alice set ghost span is 2')
  assert.equal(alice.dict.getGhostSpan(), 5958, 'alice set ghost span is 2')

  await p(alice.close)(true)
  await p(bob.close)(true)
  await p(carol.close)(true)
})

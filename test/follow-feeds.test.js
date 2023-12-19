const test = require('node:test')
const assert = require('node:assert')
const p = require('node:util').promisify
const { createPeer } = require('./util')

function getTexts(msgs) {
  return msgs.filter((msg) => msg.data?.text).map((msg) => msg.data.text)
}

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
  assert(await p(alice.set.add)('follow', bobID), 'alice follows bob')

  alice.conductor.start(aliceID, [['post'], ['post']], 64_000_000)
  bob.conductor.start(bobID, [['post'], ['post']], 64_000_000)

  const aliceDialingBob = await p(alice.connect)(bob.getAddress())
  const aliceDialingCarol = await p(alice.connect)(carol.getAddress())
  await p(setTimeout)(1000)

  assert.deepEqual(
    getTexts([...alice.db.msgs()]),
    ['A0', 'A1', 'A2', 'A3', 'A4', /*    */ 'B0', 'B1', 'B2', 'B3', 'B4'],
    'alice has alice and bob posts'
  )

  await p(aliceDialingBob.close)(true)
  await p(aliceDialingCarol.close)(true)
  await p(alice.close)(true)
  await p(bob.close)(true)
  await p(carol.close)(true)
})

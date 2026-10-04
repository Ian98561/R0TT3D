import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeliveryAck, deliveryAckTarget, DELIVERY_ACK_MSGTYPE } from './deliveryAck.ts'

test('creates a per-message acknowledgement that points to the original event', () => {
  const eventId = '$event123:localhost'
  const ack = createDeliveryAck(eventId)
  assert.deepEqual(ack, { msgtype: DELIVERY_ACK_MSGTYPE, body: eventId })
  assert.equal(deliveryAckTarget(ack), eventId)
})

test('ignores ordinary messages and malformed acknowledgement events', () => {
  assert.equal(deliveryAckTarget({ msgtype: 'm.text', body: '$event' }), undefined)
  assert.equal(deliveryAckTarget({ msgtype: DELIVERY_ACK_MSGTYPE, body: 'not-an-event-id' }), undefined)
  assert.equal(deliveryAckTarget(null), undefined)
})

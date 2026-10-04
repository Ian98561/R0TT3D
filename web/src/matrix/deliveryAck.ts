export const DELIVERY_ACK_MSGTYPE = 'org.r0tt3d.delivery_ack'

export function createDeliveryAck(eventId: string): { msgtype: string; body: string } {
  return { msgtype: DELIVERY_ACK_MSGTYPE, body: eventId }
}

export function deliveryAckTarget(content: unknown): string | undefined {
  if (!content || typeof content !== 'object') return undefined
  const value = content as { msgtype?: unknown; body?: unknown }
  if (value.msgtype !== DELIVERY_ACK_MSGTYPE || typeof value.body !== 'string' || !value.body.startsWith('$')) return undefined
  return value.body
}

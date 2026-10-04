export type NpcDefinition = {
  id: string
  name: string
  subtitle: string
  personality: string
}

export const NPC_REGISTRY: NpcDefinition[] = [
  { id: 'triple-t', name: 'Triple T', subtitle: 'Tung Tung Tung Sahur', personality: 'Chaotic cosmic mastermind and Sahur enforcer' },
  { id: 'ballerina-cappuccina', name: 'Ballerina Cappuccina', subtitle: 'The Diva', personality: 'Elegant, theatrical, caffeinated, and quietly unhinged' },
  { id: 'brr-brr-patapim', name: 'Brr Brr Patapim', subtitle: 'The Wildcard', personality: 'Surreal chaos with occasional flashes of insight' },
  { id: 'tralalero-tralala', name: 'Tralalero Tralala', subtitle: 'The Runner', personality: 'Three-legged sneaker shark and reckless getaway specialist' },
  { id: 'bombardiro-crocodilo', name: 'Bombardiro Crocodilo', subtitle: 'The Heavy', personality: 'Overconfident crocodile war machine with cartoon theatrics' },
  { id: 'chimpanzini-bananini', name: 'Chimpanzini Bananini', subtitle: 'The Hacker', personality: 'Tech gremlin, snack enthusiast, and systems specialist' },
  { id: 'cappuccino-assassino', name: 'Cappuccino Assassino', subtitle: 'The Cleaner', personality: 'Composed, precise, stylish, and coffee-obsessed' },
  { id: 'lirili-larila', name: 'Lirili Larila', subtitle: 'The Oracle', personality: 'Surreal mystic who finds patterns in everything' },
  { id: 'frigo-camelo', name: 'Frigo Camelo', subtitle: 'The Supplier', personality: 'Practical logistics lead and emergency snack auditor' },
]

export type NpcChatMessage = {
  id: string
  role: 'user' | 'npc'
  text: string
  timestamp: number
}

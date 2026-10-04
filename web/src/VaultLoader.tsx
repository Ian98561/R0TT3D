type VaultLoaderProps = { size?: number }

export default function VaultLoader({ size = 150 }: VaultLoaderProps) {
  return (
    <div className="vault-loader" aria-label="Vault unlocking">
      <style>{`
        .vault-loader { display: grid; place-items: center; }
        .vault-loader svg { width: ${size}px; height: ${size}px; overflow: visible; }
        .vault-wheel { transform-origin: 70px 70px; animation: vaultWheel 900ms ease-in-out infinite; }
        .vault-door { animation: vaultPulse 900ms ease-in-out infinite; transform-origin: center; }
        @keyframes vaultWheel {
          0%, 10% { transform: rotate(0deg); }
          65%, 82% { transform: rotate(70deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes vaultPulse {
          0%, 55% { transform: scale(1); }
          68%, 82% { transform: scale(1.01); }
          100% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .vault-wheel, .vault-door { animation: none; }
        }
      `}</style>
      <svg viewBox="0 0 140 140" role="img" aria-hidden="true">
        <g className="vault-door">
          <rect x="13" y="13" width="114" height="114" rx="6" fill="#d8c58f" stroke="#383735" strokeWidth="5" />
          <rect x="22" y="22" width="96" height="96" rx="5" fill="#e7d6a8" stroke="#696762" strokeWidth="4" />
          <circle cx="70" cy="70" r="29" fill="#676664" />
          <circle cx="70" cy="70" r="22" fill="#4d4d4b" />
          <g className="vault-wheel">
            <line x1="70" y1="34" x2="70" y2="50" stroke="#676664" strokeWidth="7" strokeLinecap="round" />
            <line x1="70" y1="90" x2="70" y2="106" stroke="#676664" strokeWidth="7" strokeLinecap="round" />
            <line x1="34" y1="70" x2="50" y2="70" stroke="#676664" strokeWidth="7" strokeLinecap="round" />
            <line x1="90" y1="70" x2="106" y2="70" stroke="#676664" strokeWidth="7" strokeLinecap="round" />
            <line x1="45" y1="45" x2="56" y2="56" stroke="#676664" strokeWidth="7" strokeLinecap="round" />
            <line x1="84" y1="84" x2="95" y2="95" stroke="#676664" strokeWidth="7" strokeLinecap="round" />
            <line x1="45" y1="95" x2="56" y2="84" stroke="#676664" strokeWidth="7" strokeLinecap="round" />
            <line x1="84" y1="56" x2="95" y2="45" stroke="#676664" strokeWidth="7" strokeLinecap="round" />
            <circle cx="70" cy="70" r="14" fill="#d9b053" />
          </g>
          <rect x="119" y="44" width="9" height="20" rx="1" fill="#c82115" stroke="#383735" strokeWidth="3" />
          <rect x="119" y="76" width="9" height="20" rx="1" fill="#c82115" stroke="#383735" strokeWidth="3" />
        </g>
      </svg>
    </div>
  )
}

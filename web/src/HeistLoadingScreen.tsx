import { useEffect, useMemo, useState } from 'react'
import VaultLoader from './VaultLoader'

type HeistLoadingScreenProps = {
  progress?: number
  progressStep?: number
  progressIntervalMs?: number
  complete?: boolean
  title?: string
  subtitle?: string
}

function LoadingBar({
  progress = 8,
}: {
  progress?: number
}) {
  const value = Math.max(0, Math.min(100, progress))
  const tickerText = useMemo(() => {
    const messages = [
      "Triple T's on the scene",
      'ciphertext only, no leaks',
      'vault secured, vibes immaculate',
      'encrypting the yap',
      'rizz loading, opsec immaculate',
      'rotcode goes brrrr',
      'lowkey locked in',
      'stealth mode: fully locked in',
      'zero plaintext, maximum aura',
      'secure comms, smooth getaway',
    ]
    for (let index = messages.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[messages[index], messages[swapIndex]] = [messages[swapIndex], messages[index]]
    }
    return messages.join('  •  ') + '  •  '
  }, [])
  return (
    <div className="loading-bar">
      <style>{`
        .loading-bar { width: min(520px, 82vw); }
        .loading-track { position: relative; height: 34px; overflow: hidden; border: 2px solid #343331; border-radius: 10px; background: #dfd3b6; }
        .loading-fill { position: absolute; inset: 0 auto 0 0; width: ${value}%; background: #c82115; transition: width 180ms linear; }
        .loading-fill::after { content: ''; position: absolute; top: 0; right: -2px; width: 2px; height: 100%; background: #343331; }
        .loading-text { position: absolute; inset: 0; display: flex; align-items: center; overflow: hidden; white-space: nowrap; pointer-events: none; }
        .loading-text.loaded { z-index: 2; width: ${value}%; right: auto; }
        .loading-text span { flex: none; min-width: max-content; padding-left: 14px; color: #3d3933; font: 600 13px/1 Arial, Helvetica, sans-serif; animation: loaderTicker 30s linear infinite; }
        .loading-text.loaded span { color: #3d3933; }
        @keyframes loaderTicker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .loading-text span { animation: none; } }
      `}</style>
      <div className="loading-track" role="progressbar" aria-label="Loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
        <div className="loading-fill" />
        <div className="loading-text"><span>{tickerText}{tickerText}</span></div>
        <div className="loading-text loaded"><span>{tickerText}{tickerText}</span></div>
      </div>
    </div>
  )
}

export default function HeistLoadingScreen({
  progress = 8,
  progressStep = 2,
  progressIntervalMs = 500,
  complete = false,
  title = 'Cracking the vault...',
  subtitle = 'Triple T is getting the channel ready.',
}: HeistLoadingScreenProps) {
  const [visibleProgress, setVisibleProgress] = useState(Math.min(progress, 85))

  useEffect(() => {
    if (complete) {
      setVisibleProgress(100)
      return
    }
    setVisibleProgress((current) => Math.max(current, Math.min(progress, 85)))
    const timer = window.setInterval(() => {
      setVisibleProgress((current) => Math.min(90, current + progressStep))
    }, progressIntervalMs)
    return () => window.clearInterval(timer)
  }, [progress, progressStep, progressIntervalMs, complete])

  return (
    <main className="heist-loader-page" role="status" aria-live="polite">
      <style>{`
        .heist-loader-page { min-height: 100vh; min-height: 100dvh; width: 100%; display: grid; place-items: center; padding: 24px; background: linear-gradient(rgba(46, 26, 12, .08), rgba(46, 26, 12, .08)), url('/theme/rowdyhacks-corkboard.webp') center / cover fixed no-repeat; color: #292826; font-family: Arial, Helvetica, sans-serif; }
        .heist-loader-content { width: min(620px, 100%); display: flex; flex-direction: column; align-items: center; text-align: center; padding: 28px 34px; border: 1px solid rgba(217, 176, 83, .8); border-radius: 16px; background: rgba(35, 25, 18, .9); box-shadow: 0 18px 54px rgba(0, 0, 0, .42); }
        .heist-loader-title { margin: 10px 0 6px; color: #fff8e9; text-shadow: 0 2px 4px #000; font-size: clamp(28px, 4.2vw, 42px); line-height: 1; font-weight: 800; letter-spacing: -1.25px; }
        .heist-loader-subtitle { margin: 0 0 22px; color: #f3e6ca; text-shadow: 0 1px 3px #000; font-size: 14px; line-height: 1.4; }
        .heist-loader-status { margin-top: 12px; color: #f3e6ca; text-shadow: 0 1px 3px #000; font-size: 13px; font-weight: 600; }
        @media (max-width: 520px) { .heist-loader-content { padding: 24px 18px; } }
      `}</style>
      <section className="heist-loader-content">
        <VaultLoader size={150} />
        <h1 className="heist-loader-title">{title}</h1>
        <p className="heist-loader-subtitle">{subtitle}</p>
        <LoadingBar progress={visibleProgress} />
        <div className="heist-loader-status">opening secure channel</div>
      </section>
    </main>
  )
}

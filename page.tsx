"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BASELINE_SCHEDULE,
  ROUNDS,
  SIMULATED_START,
  calculateTotals,
  getSeedForEmail,
  getStorageKey,
  resolveBracketState,
  type Predictions,
  type RoundId,
  type Schedule,
} from "@/lib/schedule"
import { PredictorHeader } from "@/components/predictor-header"
import { MatchCard } from "@/components/match-card"
import { AuthModal } from "@/components/auth-modal"

export function WorldCupPredictor() {
  const [currentRound, setCurrentRound] = useState<RoundId>("r32")
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [authModal, setAuthModal] = useState(false)
  const [authEmail, setAuthEmail] = useState("")
  const [userEmail, setUserEmail] = useState("")
  const [mounted, setMounted] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  const [currentTime, setCurrentTime] = useState(() => new Date(SIMULATED_START))
  const [matchSchedule, setMatchSchedule] = useState<Schedule>(BASELINE_SCHEDULE)
  const [predictions, setPredictions] = useState<Predictions>({})

  // BACKGROUND LIVE API FETCH SYNC MODULE
  const fetchLiveScores = useCallback(async () => {
    setIsSyncing(true)
    try {
      const res = await fetch("/api/world-cup-scores", { cache: "no-store" })
      if (res.ok) {
        const liveData = (await res.json()) as Schedule
        if (liveData && liveData.r32) setMatchSchedule(liveData)
      }
    } catch (err) {
      console.warn("[v0] Live API offline. Operating on baseline fallback matrix.", err)
    } finally {
      setIsSyncing(false)
    }
  }, [])

  // One-time bootstrap: restore session + isolated picks, then start polling + clock.
  useEffect(() => {
    setMounted(true)

    const savedLogin = localStorage.getItem("wc_is_logged_in")
    const savedEmail = localStorage.getItem("wc_user_email") || ""

    let initialEmail = ""
    if (savedLogin === "true" && savedEmail) {
      setIsLoggedIn(true)
      setUserEmail(savedEmail)
      initialEmail = savedEmail
    }

    const saved = localStorage.getItem(getStorageKey(initialEmail))
    if (saved) {
      try {
        setPredictions(JSON.parse(saved))
      } catch (e) {
        console.error("[v0] Failed to parse saved predictions", e)
      }
    } else {
      setPredictions(getSeedForEmail(initialEmail))
    }

    fetchLiveScores()
    const apiInterval = setInterval(fetchLiveScores, 30000)
    const clockTimer = setInterval(() => setCurrentTime((prev) => new Date(prev.getTime() + 1000)), 1000)

    return () => {
      clearInterval(apiInterval)
      clearInterval(clockTimer)
    }
  }, [fetchLiveScores])

  // Persist picks under the user-specific key so profiles never leak into one another.
  useEffect(() => {
    if (!mounted) return
    localStorage.setItem(getStorageKey(userEmail), JSON.stringify(predictions))
    localStorage.setItem("wc_is_logged_in", isLoggedIn ? "true" : "false")
    localStorage.setItem("wc_user_email", userEmail)
  }, [predictions, isLoggedIn, userEmail, mounted])

  const handleScoreChange = (matchId: string, side: "homeScore" | "awayScore", value: string) => {
    setPredictions((prev) => {
      const current = prev[matchId] || { homeScore: "", awayScore: "", penaltyWinner: null }
      const updated = { ...current, [side]: value }
      // Clear the penalty pick whenever the scores are no longer level.
      if (updated.homeScore !== updated.awayScore) updated.penaltyWinner = null
      return { ...prev, [matchId]: updated }
    })
  }

  const handlePenaltyWinnerChange = (matchId: string, winner: string) => {
    setPredictions((prev) => ({
      ...prev,
      [matchId]: { ...(prev[matchId] || { homeScore: "", awayScore: "", penaltyWinner: null }), penaltyWinner: winner },
    }))
  }

  const handleProfileConfirm = () => {
    const email = authEmail.trim()
    if (!email) return
    setUserEmail(email)
    setIsLoggedIn(true)
    setAuthModal(false)

    const contextPicks = localStorage.getItem(getStorageKey(email))
    setPredictions(contextPicks ? JSON.parse(contextPicks) : getSeedForEmail(email))
  }

  const handleLogout = () => {
    setIsLoggedIn(false)
    setUserEmail("")
    setAuthEmail("")
    const guestPicks = localStorage.getItem(getStorageKey(""))
    setPredictions(guestPicks ? JSON.parse(guestPicks) : {})
  }

  const dynamicTree = useMemo(() => resolveBracketState(matchSchedule, predictions), [matchSchedule, predictions])
  const scoreboard = useMemo(() => calculateTotals(matchSchedule, predictions), [matchSchedule, predictions])
  const currentMs = currentTime.getTime()

  // Avoid hydration mismatch from the live clock by gating render until mounted.
  if (!mounted) return <div className="min-h-screen bg-[#050811]" />

  return (
    <div className="min-h-screen bg-[#050811] text-slate-100 font-sans antialiased">
      <PredictorHeader
        scoreboard={scoreboard}
        clock={
          currentTime.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: "America/New_York",
          }) + " ET"
        }
        isLoggedIn={isLoggedIn}
        userEmail={userEmail}
        isSyncing={isSyncing}
        onSignInClick={() => setAuthModal(true)}
        onLogout={handleLogout}
      />

      <main className="max-w-7xl mx-auto px-6 mt-8 pb-16">
        <nav className="flex flex-wrap gap-2 border-b border-slate-800/80 pb-5 mb-8">
          {ROUNDS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCurrentRound(tab.id)}
              className={`px-6 py-3 text-xs font-black rounded-xl border uppercase tracking-widest transition-all ${
                currentRound === tab.id
                  ? "bg-gradient-to-b from-[#16253f] to-[#0a111f] text-white border-[#d2143a]"
                  : "bg-slate-900/20 border-slate-800/60 text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {dynamicTree[currentRound]?.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              prediction={predictions[match.id] || { homeScore: "", awayScore: "", penaltyWinner: null }}
              currentMs={currentMs}
              onScoreChange={handleScoreChange}
              onPenaltyWinnerChange={handlePenaltyWinnerChange}
            />
          ))}
        </section>
      </main>

      {authModal && (
        <AuthModal
          email={authEmail}
          onEmailChange={setAuthEmail}
          onCancel={() => setAuthModal(false)}
          onConfirm={handleProfileConfirm}
        />
      )}
    </div>
  )
}

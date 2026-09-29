import type { FastifyInstance } from "fastify"
import { GameMode, GamePhase, type WsClientMessage, type WsServerMessage } from "@blindmusic/shared"
import {
  rooms,
  registerSocket,
  markDisconnected,
  broadcastLobby,
  getCurrentRound,
  getPendingStart,
  updateSettings,
  updateAvatar,
  startGame,
  processGuess,
  getEndSummary,
  setPreparing,
  appendTracks,
  finishTrackLoading,
} from "@/game/engine"
import { fetchTrackPool, pickRandomTracks } from "@/deezer"
import { streamAnimeTracks } from "@/anime"
import { prisma } from "@/db"

export default async function wsRoute(fastify: FastifyInstance) {
  fastify.get("/ws", { websocket: true }, function (socket, req) {
    const query = req.query as { code?: string; playerId?: string }
    const { code, playerId } = query

    function send(msg: WsServerMessage) {
      socket.send(JSON.stringify(msg))
    }

    if (!code || !playerId) {
      send({ type: "error", message: "code et playerId requis" })
      socket.close()
      return
    }

    const registered = registerSocket(code, playerId, send)
    if (!registered) {
      send({ type: "error", message: "Salon introuvable ou joueur inconnu" })
      socket.close()
      return
    }

    // Tell everyone (including the joiner) about the updated roster
    broadcastLobby(code)

    // Resume an in-progress round so page navigation does not skip the track
    const current = getCurrentRound(code)
    if (current) {
      send({ type: "round:start", round: current })
    } else {
      const startsAt = getPendingStart(code)
      if (startsAt) send({ type: "game:start", startsAt })
      const summary = getEndSummary(code)
      if (summary) send(summary)
    }

    socket.on("message", async (raw: Buffer) => {
      let msg: WsClientMessage
      try {
        msg = JSON.parse(raw.toString()) as WsClientMessage
      } catch {
        return
      }

      const room = rooms.get(code)
      if (!room) return

      switch (msg.type) {
        case "lobby:settings": {
          if (room.hostId !== playerId) return
          updateSettings(code, msg.settings)
          break
        }

        case "lobby:start": {
          if (room.hostId !== playerId) return
          if (room.phase !== GamePhase.Lobby && room.phase !== GamePhase.End) return
          const requestedIds = msg.settings.playlistIds ?? []
          const playlists = requestedIds.length
            ? await prisma.playlist.findMany({ where: { id: { in: requestedIds } } })
            : []
          const customIds = (msg.settings.customDeezerPlaylistIds ?? []).filter((id) => /^\d+$/.test(id))
          const deezerIds = [...playlists.map((p) => p.deezerPlaylistId), ...customIds]
          if (deezerIds.length === 0) {
            send({ type: "error", message: "Aucune playlist selectionnee" })
            return
          }
          if (!setPreparing(code, true)) return
          const settings = msg.settings
          const fail = (message: string) => {
            setPreparing(code, false)
            send({ type: "error", message })
          }

          if (settings.mode !== GameMode.Anime) {
            const tracks = await pickRandomTracks(deezerIds, settings.trackCount).catch(() => [])
            if (tracks.length === 0) return fail("Aucun titre jouable trouve dans ces playlists")
            if ((await startGame(code, settings, tracks)) === null) setPreparing(code, false)
            return
          }

          // Anime mode: start on the first recognised theme, keep matching the rest meanwhile
          const pool = await fetchTrackPool(deezerIds).catch(() => [])
          let gameId: number | null = null
          let started = false
          await streamAnimeTracks(pool, settings.trackCount, async (tracks) => {
            if (started) return gameId !== null && appendTracks(code, gameId, tracks)
            started = true
            gameId = await startGame(code, settings, tracks, { loadingMore: settings.trackCount > tracks.length })
            if (gameId === null) setPreparing(code, false)
            return gameId !== null && settings.trackCount > tracks.length
          }).catch(() => {})
          if (started && gameId === null) return
          if (gameId === null) return fail("Aucun opening/ending d'anime reconnu dans ces playlists")
          finishTrackLoading(code, gameId)
          break
        }

        case "guess": {
          const result = processGuess(code, playerId, msg.text)
          if (!result) return
          const player = room.players.get(playerId)
          // Opponents learn that someone scored, never what the answer is
          const shared: WsServerMessage = {
            type: "guess:result",
            playerId,
            playerName: player?.name ?? "",
            matched: result.matched,
            pointsEarned: result.pointsEarned,
            scores: result.scores,
            firstBoth: result.firstBoth,
            yearGuessesLeft: result.yearGuessesLeft,
          }
          const mine: WsServerMessage = {
            ...shared,
            text: msg.text,
            revealedArtist: result.revealedArtist,
            revealedTitle: result.revealedTitle,
            revealedAnime: result.revealedAnime,
          }
          for (const p of room.players.values()) {
            try {
              p.send(p.id === playerId ? mine : shared)
            } catch {}
          }
          break
        }

        case "player:avatar": {
          updateAvatar(code, playerId, msg.avatarSeed)
          break
        }

        case "chat": {
          const player = room.players.get(playerId)
          if (!player) return
          const chatMsg: WsServerMessage = {
            type: "chat:message",
            playerId,
            playerName: player.name,
            text: msg.text.slice(0, 200),
            at: Date.now(),
          }
          for (const p of room.players.values()) {
            try {
              p.send(chatMsg)
            } catch {}
          }
          break
        }

        default: {
          const _exhaustive: never = msg
          void _exhaustive
        }
      }
    })

    socket.on("close", () => {
      markDisconnected(code, playerId, send)
    })
  })
}

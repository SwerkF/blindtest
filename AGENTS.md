## Learned User Preferences

- Prefers French for product UI and agent communication.
- No mandatory account/signup flow: players enter a pseudo only; Discord login is optional.
- Music integration and branding should be Deezer, not Spotify.
- Persist username, avatar seed, and recent game history in localStorage.
- Avatars use Blobatar (`@blobatar/react`); players pick/change avatar when joining or creating a lobby, and avatars should stay clearly visible.
- Guessing uses one fuzzy input field (not separate artist/title/year fields).
- Title matching should strip remakes like remix/radio edit and parentheses, and ignore accents.
- Dark mode should be available.
- Lobby hosts can paste their own Deezer playlist URL in addition to curated playlists; tracks from selected playlists should be shuffled.

## Learned Workspace Facts

- Blindtest is a multiplayer music blind-test monorepo (`apps/web`, `apps/server`, `packages/shared`) with invite-code lobbies and WebSocket gameplay.
- Persistence uses Prisma + SQLite; curated site playlists live in the DB, while ad-hoc user Deezer playlists are not stored in the DB.
- Playback uses ~30s Deezer track previews.
- Local/deploy stack is driven by Docker Compose; intended production host is `https://blindtest.oliwr.win`.
- Core scoring: artist alone 5, title alone 5, both 20 with −2 per later finder; year is a limited-try bonus (+2).
- Anime blind-test mode (`GameMode.Anime`): Deezer playlist tracks are matched to AnimeThemes.moe songs (`apps/server/src/anime.ts`, throttled to 80 req/min); accepted answers come from `apps/server/src/animeNames.ts`: AnimeThemes names/synonyms, AniList titles (searched by name and by franchise name, plus the AniList id when known), a built-in alias list (FR/EN), season-stripped cores, subtitles, word-boundary prefixes and initials acronyms. The reveal/end screen show the best-known name (`bestKnownName`: built-in alias that is not an abbreviation, then AniList English, romaji, AnimeThemes name; `originalName` keeps the AnimeThemes one). Anime points shrink with time (20 → 5), singer bonus +5, year bonus kept, no early hint, no OP/ED number guessing. The game starts on the first matched track and the rest is appended in the background. Curated playlists carry a `category` (`classic` | `anime`).
- Game UI: per-round found badges (artist/title/year) and round points beside the total, gold crown on the clear leader, presence via Blobatar expressions (`thinking` while typing, `sleepy` when disconnected), emoji reactions broadcast to everyone (`REACTIONS` in shared; at most 6 floating at once, gear-menu option « Masquer les réactions des autres »), server anti-spam in `apps/server/src/game/spam.ts` (chat and reactions each 5 per 5 s then muted 5 s, 400ms reaction cooldown, identical chat message dropped for 10 s, sender gets a `spam:notice` « Doucement… » toast), countdown beeps on 3-2-1, and a "Quitter" button (`leave` message removes the player at once).
- Rooms can have a host-set password and can refuse late joiners (`lobby:access`); a missing room redirects home with a notice. Colour themes (`utils/palette.ts`, `[data-palette]` CSS) are picked from the gear menu; pages use a repeating shape pattern on `.bg-canvas`, no blur/glow effects.
- Optional Discord accounts (`apps/server/src/account/`): OAuth2 `identify` flow at `/auth/discord`, HMAC-signed httpOnly `bt_session` cookie backed by a `Session` row; env `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `SESSION_SECRET`, `WEB_ORIGIN` (see `.env.example`). Logged-in players get server-side history (`GameResult`, written from the engine's `onGameEnd` hook), achievements (`ACHIEVEMENTS` in `packages/shared/src/account.ts`), friends (friend code or search) and a per-user socket `/ws/user` for presence, friend requests, lobby invites and achievement toasts. The web app mounts `AccountRoot` (toasts + user socket) around every route; `/profil` has Historique / Succès / Amis tabs.

## Learned User Preferences

- Prefers French for product UI and agent communication.
- No account/signup flow: players enter a pseudo only.
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
- Anime blind-test mode (`GameMode.Anime`): Deezer playlist tracks are matched to AnimeThemes.moe songs (`apps/server/src/anime.ts`, throttled to 80 req/min); accepted answers come from `apps/server/src/animeNames.ts`: AnimeThemes names/synonyms, AniList titles (searched by name and by franchise name, plus the AniList id when known), a built-in alias list (FR/EN), season-stripped cores, subtitles, word-boundary prefixes and initials acronyms. Anime points shrink with time (20 → 5), singer bonus +5, year bonus kept, no early hint, no OP/ED number guessing. The game starts on the first matched track and the rest is appended in the background. Curated playlists carry a `category` (`classic` | `anime`).

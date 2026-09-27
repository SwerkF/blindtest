import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

interface Curated {
  name: string
  slug: string
  deezerPlaylistId: string
  description: string
}

interface DeezerPlaylist {
  nb_tracks?: number
  picture_medium?: string
}

const curated: Curated[] = [
  {
    name: "Hits 2010",
    slug: "hits-2010",
    deezerPlaylistId: "5339620562",
    description: "Les tubes incontournables des annees 2010",
  },
  {
    name: "Top France",
    slug: "top-france",
    deezerPlaylistId: "1109890291",
    description: "Les titres les plus ecoutes en France",
  },
  {
    name: "Hits 2000",
    slug: "hits-2000",
    deezerPlaylistId: "248297032",
    description: "Les meilleurs sons des annees 2000",
  },
  {
    name: "Annees 90",
    slug: "annees-90",
    deezerPlaylistId: "1251125011",
    description: "Retour dans les annees 90",
  },
  {
    name: "Annees 80",
    slug: "annees-80",
    deezerPlaylistId: "1163842311",
    description: "Les classiques des annees 80",
  },
  {
    name: "Rap FR",
    slug: "rap-fr",
    deezerPlaylistId: "13154564983",
    description: "Le meilleur du rap francais",
  },
  {
    name: "Pop All Stars",
    slug: "pop-all-stars",
    deezerPlaylistId: "1282483245",
    description: "La pop internationale qui cartonne",
  },
]

for (const p of curated) {
  let trackCount = 0
  let coverUrl: string | null = null

  try {
    const res = await fetch(`https://api.deezer.com/playlist/${p.deezerPlaylistId}`)
    if (res.ok) {
      const meta: DeezerPlaylist = await res.json()
      trackCount = meta.nb_tracks ?? 0
      coverUrl = meta.picture_medium ?? null
    }
  } catch {
    console.warn(`Deezer metadata unavailable for ${p.slug}`)
  }

  const data = { ...p, trackCount, coverUrl }
  await prisma.playlist.upsert({ where: { slug: p.slug }, update: data, create: data })
  console.log(`  ${p.name} — ${trackCount} titres`)
}

await prisma.$disconnect()
console.log(`Seeded ${curated.length} playlists.`)

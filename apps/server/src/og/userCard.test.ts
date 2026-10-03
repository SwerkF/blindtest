import { expect, test } from "bun:test"
import { blobSvg, cachedCard, cardHash, renderUserCard, storeCard, type UserCardData } from "@/og/userCard"

const DATA: UserCardData = {
  pseudo: "Nelly Mélodie",
  username: "Nelly",
  avatarSeed: "v1|nelly|sun|30||happy",
  avatarUrl: null,
  gamesPlayed: 12,
  wins: 6,
  winRate: 50,
  achievements: 3,
}

test("carte OG : le hash suit ce qui est dessiné", () => {
  expect(cardHash(DATA)).toBe(cardHash({ ...DATA }))
  expect(cardHash({ ...DATA, wins: 7 })).not.toBe(cardHash(DATA))
  expect(cardHash({ ...DATA, pseudo: "Nelly" })).not.toBe(cardHash(DATA))
})

test("carte OG : Blobatar rendu côté serveur à partir de l'avatar encodé", () => {
  const svg = blobSvg(DATA.avatarSeed, 200)
  expect(svg.startsWith("<svg")).toBe(true)
  expect(svg).toContain('width="200"')
  // Same seed, different customisation → different drawing
  expect(blobSvg("v1|nelly|cloud|200||sad", 200)).not.toBe(svg)
})

test("carte OG : PNG 1200×630", async () => {
  const { png, complete } = await renderUserCard(DATA)
  expect(complete).toBe(true)
  expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG")
  const view = new DataView(png.buffer, png.byteOffset)
  expect(view.getUint32(16)).toBe(1200)
  expect(view.getUint32(20)).toBe(630)
}, 20000)

test("carte OG : cache par utilisateur et hash", () => {
  const png = new Uint8Array([1, 2, 3])
  storeCard("u1", "h1", png)
  expect(cachedCard("u1", "h1")).toBe(png)
  expect(cachedCard("u1", "h2")).toBeNull()
  expect(cachedCard("u2", "h1")).toBeNull()
})

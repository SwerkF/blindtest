/**
 * Who publishes and hosts the site, shown in the legal pages (LCEN art. 6-III).
 * Same details as https://kreio.fr/mentions-legales. Empty fields are not displayed.
 */
export const PUBLISHER = {
  name: "Kreio",
  url: "https://kreio.fr",
  /** Exploitant de l'entreprise individuelle, also directeur de la publication. */
  owner: "Oliwer Skweres",
  legalForm: "Entreprise individuelle (micro-entreprise)",
  siret: "104 521 125 00013",
  vat: "Non applicable (TVA non applicable, art. 293 B du CGI)",
  /** Full postal address (a domiciliation address works); falls back to the city. */
  address: "",
  city: "Évreux, France",
  phone: "06 40 81 00 44",
  email: "hello@kreio.fr",
}

/** The site runs on the publisher's own server: the publisher is also the host. */
export const HOST = {
  selfHosted: true,
  name: "",
  address: "",
  url: "",
}

export const SITE = {
  name: "Blindtest",
  url: "https://blindtest.oliwr.win",
}

export const LEGAL_UPDATED_AT = "29 septembre 2026"

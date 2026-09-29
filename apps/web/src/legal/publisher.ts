/**
 * Who publishes and hosts the site, shown in the legal pages. Empty fields are
 * simply not displayed: fill them in before going to production (French law
 * requires the SIRET, an address and a contact for the publisher, and the
 * host's name and address).
 */
export const PUBLISHER = {
  name: "Kreio",
  url: "https://kreio.fr",
  legalForm: "Entreprise individuelle (micro-entreprise)",
  /** Directeur de la publication. */
  director: "",
  siret: "",
  address: "",
  email: "",
}

export const HOST = {
  name: "",
  address: "",
  url: "",
}

export const SITE = {
  name: "Blindtest",
  url: "https://blindtest.oliwr.win",
}

export const LEGAL_UPDATED_AT = "29 septembre 2026"

import type { ReactNode } from "react"
import { Link, NavLink } from "react-router-dom"
import { ArrowLeft, MusicNote } from "@phosphor-icons/react"
import SettingsMenu from "@/components/SettingsMenu"
import { HOST, LEGAL_UPDATED_AT, PUBLISHER, SITE } from "@/legal/publisher"

export enum LegalDoc {
  Notice = "mentions-legales",
  Terms = "cgu",
  Privacy = "confidentialite",
}

const TABS: { doc: LegalDoc; label: string }[] = [
  { doc: LegalDoc.Notice, label: "Mentions légales" },
  { doc: LegalDoc.Terms, label: "Conditions d'utilisation" },
  { doc: LegalDoc.Privacy, label: "Confidentialité" },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-ink mb-3">{title}</h2>
      <div className="flex flex-col gap-3 text-sm text-ink/85 leading-relaxed">{children}</div>
    </section>
  )
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  )
}

/** One "Label : value" line, skipped while the value is not filled in. */
function Field({ label, value }: { label: string; value: ReactNode }) {
  if (!value) return null
  return (
    <p>
      <span className="text-muted">{label} : </span>
      {value}
    </p>
  )
}

function Contact() {
  return PUBLISHER.email ? (
    <a href={`mailto:${PUBLISHER.email}`} className="text-accent hover:underline">
      {PUBLISHER.email}
    </a>
  ) : (
    <>
      via le site <Ext href={PUBLISHER.url}>kreio.fr</Ext>
    </>
  )
}

const PUBLISHER_ADDRESS = PUBLISHER.address || PUBLISHER.city

function Notice() {
  return (
    <>
      <p className="text-sm text-ink/85 leading-relaxed mb-8">
        Conformément aux articles 6-III et 19 de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans
        l'économie numérique (LCEN), voici les informations sur l'éditeur et l'hébergeur de {SITE.name}.
      </p>

      <Section title="Éditeur du site">
        <p>
          Le site {SITE.name} (<Ext href={SITE.url}>{SITE.url.replace("https://", "")}</Ext>) est édité par{" "}
          {PUBLISHER.owner}, entrepreneur individuel exerçant sous le nom commercial{" "}
          <Ext href={PUBLISHER.url}>{PUBLISHER.name}</Ext>.
        </p>
        <div className="flex flex-col gap-1">
          <Field label="Nom commercial" value={PUBLISHER.name} />
          <Field label="Exploitant" value={PUBLISHER.owner} />
          <Field label="Forme juridique" value={PUBLISHER.legalForm} />
          <Field label="Siège" value={PUBLISHER_ADDRESS} />
          <Field label="SIRET" value={PUBLISHER.siret} />
          <Field label="N° TVA intracommunautaire" value={PUBLISHER.vat} />
          <Field label="Téléphone" value={PUBLISHER.phone} />
          <p>
            <span className="text-muted">Email : </span>
            <Contact />
          </p>
        </div>
      </Section>

      <Section title="Directeur de la publication">
        <p>
          Le directeur de la publication est {PUBLISHER.owner}, responsable légal de {PUBLISHER.name}.
        </p>
      </Section>

      <Section title="Hébergement">
        {HOST.selfHosted ? (
          <>
            <p>
              Le site est hébergé par son éditeur, {PUBLISHER.name}, sur un serveur situé en France.
            </p>
            <div className="flex flex-col gap-1">
              <Field label="Adresse" value={PUBLISHER_ADDRESS} />
              <Field label="Téléphone" value={PUBLISHER.phone} />
            </div>
          </>
        ) : HOST.name ? (
          <div className="flex flex-col gap-1">
            <Field label="Hébergeur" value={HOST.url ? <Ext href={HOST.url}>{HOST.name}</Ext> : HOST.name} />
            <Field label="Adresse" value={HOST.address} />
          </div>
        ) : (
          <p>Le site est hébergé sur l'infrastructure de l'éditeur.</p>
        )}
      </Section>

      <Section title="Propriété intellectuelle">
        <p>
          Le code, le design et les textes du site sont la propriété exclusive de {PUBLISHER.name}. Toute
          reproduction, représentation, modification ou adaptation, totale ou partielle, est interdite sans
          autorisation écrite préalable.
        </p>
        <p>
          Les extraits musicaux, pochettes, noms d'artistes et de titres appartiennent à leurs ayants droit. Ils sont
          diffusés via les outils publics de <Ext href="https://www.deezer.com">Deezer</Ext> sous forme d'extraits
          d'environ 30 secondes, lus directement depuis ses serveurs : {SITE.name} ne stocke ni ne redistribue aucun
          fichier audio. Les informations sur les animés proviennent d'
          <Ext href="https://animethemes.moe">AnimeThemes</Ext> et d'<Ext href="https://anilist.co">AniList</Ext>.
        </p>
        <p>
          {SITE.name} n'est affilié ni à Deezer, ni à AnimeThemes, ni à AniList. Pour toute demande de retrait d'un
          contenu, contactez l'éditeur (<Contact />).
        </p>
      </Section>

      <Section title="Liens externes">
        <p>
          Le site contient des liens vers des sites tiers. {PUBLISHER.name} décline toute responsabilité quant à leur
          contenu et à leur politique de confidentialité.
        </p>
      </Section>

      <Section title="Droit applicable">
        <p>
          Les présentes mentions légales sont soumises au droit français. Tout litige relatif à leur interprétation
          ou à leur exécution relève de la compétence des tribunaux français.
        </p>
      </Section>
    </>
  )
}

function Terms() {
  return (
    <>
      <Section title="Objet">
        <p>
          Les présentes conditions encadrent l'utilisation de {SITE.name}, un jeu de blind test musical multijoueur
          gratuit édité par <Ext href={PUBLISHER.url}>{PUBLISHER.name}</Ext>. Utiliser le site vaut acceptation de ces
          conditions.
        </p>
      </Section>

      <Section title="Accès au service">
        <p>
          Le jeu est gratuit et ne demande aucun compte : il suffit de choisir un pseudo et un avatar. Un salon est
          accessible à toute personne qui en connaît le code, sauf si l'hôte l'a protégé par un mot de passe.
          Se connecter avec Discord est facultatif et permet de garder son historique, ses succès et ses amis.
        </p>
        <p>
          Le service est fourni « en l'état », sans garantie de disponibilité. Il peut être interrompu, modifié ou
          arrêté à tout moment, notamment pour maintenance. Un salon disparaît quand tous ses joueurs l'ont quitté ;
          seuls les résultats des joueurs connectés avec Discord sont conservés dans leur historique.
        </p>
      </Section>

      <Section title="Règles de conduite">
        <p>En utilisant le chat, les pseudos, les propositions et les réactions, vous vous engagez à ne pas :</p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>tenir de propos injurieux, haineux, discriminatoires, harcelants ou à caractère sexuel ;</li>
          <li>usurper l'identité d'une autre personne ;</li>
          <li>publier des données personnelles d'autrui ou des liens malveillants ;</li>
          <li>perturber le jeu (spam, triche automatisée, surcharge volontaire du service).</li>
        </ul>
        <p>
          Les échanges n'étant pas enregistrés, l'hôte et les joueurs restent responsables de ce qu'ils publient.
          L'éditeur peut bloquer l'accès au service en cas d'abus.
        </p>
      </Section>

      <Section title="Playlists personnalisées">
        <p>
          L'hôte peut ajouter une playlist Deezer publique par son lien. Il s'engage à n'utiliser que des playlists
          qu'il est en droit de partager. Seuls les extraits fournis publiquement par Deezer sont lus.
        </p>
      </Section>

      <Section title="Responsabilité">
        <p>
          L'éditeur fait ses meilleurs efforts pour assurer le bon fonctionnement du jeu, mais ne peut être tenu
          responsable des interruptions, des erreurs de reconnaissance des réponses, ni du contenu des services tiers
          (Deezer, AnimeThemes, AniList, paroles).
        </p>
      </Section>

      <Section title="Modification et droit applicable">
        <p>
          Ces conditions peuvent évoluer. La version en vigueur est celle publiée sur cette page. Elles sont soumises
          au droit français ; en cas de litige, une solution amiable sera recherchée avant toute action devant les
          tribunaux compétents.
        </p>
      </Section>
    </>
  )
}

function Privacy() {
  return (
    <>
      <Section title="Responsable du traitement">
        <p>
          Le responsable du traitement est <Ext href={PUBLISHER.url}>{PUBLISHER.name}</Ext> ({PUBLISHER.owner}),
          éditeur de {SITE.name}, dont les coordonnées figurent dans les{" "}
          <Link to={`/${LegalDoc.Notice}`} className="text-accent hover:underline">
            mentions légales
          </Link>
          . Contact : <Contact />.
        </p>
        <p>
          Le principe du jeu est d'en collecter le moins possible : compte facultatif, pas d'adresse e-mail, pas de
          publicité, pas de mesure d'audience ni de cookie de suivi.
        </p>
      </Section>

      <Section title="Données traitées pendant une partie">
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>
            <strong>Pseudo et avatar</strong> : envoyés au serveur pour les afficher aux autres joueurs du salon.
          </li>
          <li>
            <strong>Propositions, messages du chat, réactions et scores</strong> : transmis en direct aux joueurs du
            salon. Vos propositions ne sont montrées qu'à vous.
          </li>
          <li>
            <strong>Mot de passe du salon</strong>, s'il y en a un : sert uniquement à contrôler l'accès.
          </li>
        </ul>
        <p>
          Ces données sont gardées uniquement en mémoire, le temps de la partie. Elles ne sont écrites dans aucune
          base de données et disparaissent quand le salon se ferme. La base de données du site ne contient que le
          catalogue des playlists proposées.
        </p>
        <p>
          <strong>Base légale</strong> : l'exécution du service que vous demandez en rejoignant une partie.
        </p>
      </Section>

      <Section title="Compte Discord (facultatif)">
        <p>
          Si vous choisissez de vous connecter avec Discord, nous recevons uniquement votre identifiant, votre nom et
          votre image de profil Discord (autorisation « identify », sans adresse e-mail ni accès à vos serveurs ou
          messages). Nous enregistrons alors, en base de données :
        </p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>ces informations Discord, votre pseudo, votre avatar et votre code ami ;</li>
          <li>le résultat de vos parties (date, mode, score, rang) et les succès débloqués ;</li>
          <li>vos amis et demandes d'amis, et une session de connexion valable 30 jours.</li>
        </ul>
        <p>
          Vos amis voient votre pseudo, votre avatar, votre nom Discord et si vous êtes en ligne. Ces données sont
          conservées tant que le compte existe ; vous pouvez le supprimer à tout moment depuis votre profil, ce qui
          efface tout ce qui précède. <strong>Base légale</strong> : votre consentement, donné en vous connectant.
        </p>
      </Section>

      <Section title="Données techniques">
        <p>
          Comme tout serveur web, le serveur enregistre des journaux techniques (adresse IP, date, page demandée) pour
          assurer la sécurité et diagnostiquer les pannes. Ils sont conservés pour une durée limitée, puis supprimés.
          <strong> Base légale</strong> : l'intérêt légitime de l'éditeur à sécuriser le service.
        </p>
      </Section>

      <Section title="Stockage dans votre navigateur">
        <p>
          Le site n'utilise pas de cookie de suivi. Seul un cookie de session, strictement nécessaire, est déposé si
          vous vous connectez avec Discord (et un cookie temporaire pendant la connexion). Le site enregistre aussi
          dans votre navigateur (stockage local) :
        </p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>votre pseudo et votre avatar, pour ne pas les ressaisir ;</li>
          <li>l'historique de vos 20 dernières parties (rang, score, titres joués) ;</li>
          <li>vos préférences : thème, mode sombre, volume ;</li>
          <li>le temps d'un onglet, votre identifiant de joueur dans le salon en cours.</li>
        </ul>
        <p>
          Ces informations restent sur votre appareil et ne sont jamais envoyées ailleurs. Vous pouvez les effacer à
          tout moment en vidant les données du site dans votre navigateur.
        </p>
      </Section>

      <Section title="Services tiers">
        <p>Pour fonctionner, le site fait appel à des services externes :</p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>
            <Ext href="https://www.deezer.com/legal/personal-datas">Deezer</Ext> : votre navigateur charge directement
            les extraits audio et les pochettes depuis ses serveurs, qui reçoivent donc votre adresse IP.
          </li>
          <li>
            <Ext href="https://animethemes.moe">AnimeThemes</Ext> : les images des animés sont chargées depuis ses
            serveurs (mode Animé).
          </li>
          <li>
            <Ext href="https://policies.google.com/privacy">Google Fonts</Ext> : la police du site est chargée depuis
            les serveurs de Google.
          </li>
          <li>
            <Ext href="https://discord.com/privacy">Discord</Ext> (États-Unis) : uniquement si vous vous connectez ;
            les images de profil Discord sont chargées depuis ses serveurs.
          </li>
          <li>
            AnimeThemes, <Ext href="https://anilist.co">AniList</Ext> et lyrics.ovh sont interrogés par notre
            serveur, sans aucune donnée vous concernant.
          </li>
        </ul>
      </Section>

      <Section title="Hébergement et transferts hors Union européenne">
        <p>
          Le serveur du jeu est hébergé en France par l'éditeur. Les seules données qui peuvent quitter l'Union
          européenne sont votre adresse IP et les informations techniques de votre navigateur, lorsqu'il charge la
          police depuis Google Fonts (États-Unis) ou les images d'AnimeThemes. Deezer est une société française.
        </p>
      </Section>

      <Section title="Sécurité">
        <p>
          Les échanges avec le site sont chiffrés (TLS). Sans compte, rien n'est conservé au-delà de la vie d'un
          salon. Le cookie de session est signé, inaccessible aux scripts de la page et révocable à la déconnexion.
        </p>
      </Section>

      <Section title="Vos droits">
        <p>
          Conformément au RGPD et à la loi Informatique et Libertés, vous disposez d'un droit d'accès, de
          rectification, d'effacement, d'opposition et de limitation sur vos données. Sans compte, la plupart de ces
          demandes se règlent en quittant la partie ou en vidant le stockage de votre navigateur ; avec un compte,
          vous pouvez le supprimer depuis votre profil. Pour toute autre demande : <Contact />.
        </p>
        <p>
          Vous pouvez aussi introduire une réclamation auprès de la{" "}
          <Ext href="https://www.cnil.fr/fr/plaintes">CNIL</Ext>.
        </p>
      </Section>

      <Section title="Mineurs">
        <p>
          Le jeu est ouvert à tous et ne demande aucune donnée d'identité. Nous recommandons aux plus jeunes de ne pas
          utiliser leur vrai nom comme pseudo et de jouer entre personnes qu'ils connaissent.
        </p>
      </Section>
    </>
  )
}

const TITLES: Record<LegalDoc, string> = {
  [LegalDoc.Notice]: "Mentions légales",
  [LegalDoc.Terms]: "Conditions générales d'utilisation",
  [LegalDoc.Privacy]: "Politique de confidentialité",
}

export default function Legal({ doc }: { doc: LegalDoc }) {
  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors">
            <ArrowLeft size={16} weight="bold" />
            <MusicNote size={18} weight="duotone" className="text-accent" />
            {SITE.name}
          </Link>
          <SettingsMenu />
        </div>

        <nav className="flex flex-wrap gap-2 mb-8">
          {TABS.map((tab) => (
            <NavLink
              key={tab.doc}
              to={`/${tab.doc}`}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-xl text-sm font-semibold border transition-colors ${
                  isActive ? "bg-accent text-white border-accent" : "bg-surface border-edge text-muted hover:text-ink"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <article className="bg-surface border border-edge rounded-2xl p-6 md:p-8">
          <h1 className="text-2xl font-black text-ink mb-1">{TITLES[doc]}</h1>
          <p className="text-xs text-muted mb-8">Dernière mise à jour : {LEGAL_UPDATED_AT}</p>
          {doc === LegalDoc.Notice && <Notice />}
          {doc === LegalDoc.Terms && <Terms />}
          {doc === LegalDoc.Privacy && <Privacy />}
        </article>
      </div>
    </div>
  )
}

import { useEffect } from 'react'

/* ─────────────────────────────────────────────────────────────
   Control. — Textes légaux & modale
   Centralise CGU + Politique de confidentialité pour un usage
   partagé (écran d'inscription + page Profil).

   ⚠️ IMPORTANT — à compléter avant mise en production réelle :
   remplace [TON_NOM / SOCIÉTÉ], [VILLE], [EMAIL_CONTACT] et la
   région d'hébergement par tes informations exactes. Ces textes
   constituent une base sérieuse mais ne remplacent pas une
   relecture juridique si tu commercialises à grande échelle.
   ───────────────────────────────────────────────────────────── */

export const APP_EDITOR = '[TON_NOM / SOCIÉTÉ]'
export const APP_CONTACT_EMAIL = '[EMAIL_CONTACT]'
export const APP_CITY = '[VILLE]'
export const LAST_UPDATED = 'juin 2026'

/* ─── Contenu : Conditions Générales d'Utilisation ──────────────── */
export const CGU_SECTIONS = [
  {
    title: '1. Objet',
    body:
      "Control. est une application de suivi financier personnel destinée aux auto-entrepreneurs et freelances. " +
      "Elle permet de saisir et de visualiser son chiffre d'affaires, ses charges, ses dépenses et une estimation indicative des cotisations URSSAF. " +
      "Control. est un outil de suivi : les données affichées proviennent uniquement de ce que l'utilisateur saisit lui-même.",
  },
  {
    title: '2. Outil indicatif — absence de conseil',
    body:
      "Control. n'est pas un logiciel comptable certifié, ni un service de conseil fiscal, comptable ou juridique. " +
      "Les montants, taux et estimations (notamment l'estimation URSSAF) sont fournis à titre purement indicatif et reposent sur les paramètres que l'utilisateur configure lui-même, en particulier son taux de cotisation. " +
      "L'utilisateur reste seul responsable de l'exactitude de ses saisies, de ses déclarations officielles et du calcul réel de ses obligations. " +
      "Aucune donnée n'est transmise à l'URSSAF ni à aucune administration. " +
      `${APP_EDITOR} ne saurait être tenu responsable d'une erreur de saisie, d'un paramétrage incorrect ou d'une décision prise sur la base des informations affichées.`,
  },
  {
    title: '3. Compte utilisateur',
    body:
      "La création d'un compte nécessite une adresse e-mail valide et un mot de passe. " +
      "L'utilisateur est responsable de la confidentialité de ses identifiants et de toute activité réalisée depuis son compte. " +
      "Il s'engage à fournir des informations exactes lors de l'inscription.",
  },
  {
    title: '4. Disponibilité du service',
    body:
      "Control. est fourni « en l'état ». Nous nous efforçons d'assurer un accès continu mais ne garantissons pas une disponibilité ininterrompue. " +
      "Le service peut être suspendu temporairement pour maintenance ou évolution. " +
      "Nous recommandons à l'utilisateur d'exporter régulièrement ses données depuis la fonction d'export intégrée.",
  },
  {
    title: '5. Propriété des données',
    body:
      "L'utilisateur conserve la pleine propriété des données qu'il saisit. " +
      "Il peut les exporter à tout moment et demander la suppression complète de son compte et de ses données depuis l'application.",
  },
  {
    title: '6. Évolution des conditions',
    body:
      "Ces conditions peuvent être mises à jour. En cas de modification substantielle, l'utilisateur en sera informé. " +
      "La poursuite de l'utilisation vaut acceptation des conditions en vigueur.",
  },
]

/* ─── Contenu : Politique de confidentialité (RGPD) ─────────────── */
export const PRIVACY_SECTIONS = [
  {
    title: '1. Responsable du traitement',
    body:
      `Le responsable du traitement des données est ${APP_EDITOR}, éditeur de l'application Control. ` +
      `Pour toute question relative à vos données, vous pouvez nous contacter à : ${APP_CONTACT_EMAIL}.`,
  },
  {
    title: '2. Données collectées',
    body:
      "Nous collectons : (a) les données de compte que vous fournissez à l'inscription (prénom, pseudo, adresse e-mail) ; " +
      "(b) les données financières que vous saisissez vous-même (chiffre d'affaires, activités, noms de clients, charges, dépenses, paramètres URSSAF). " +
      "Nous ne collectons aucune donnée bancaire et ne sommes connectés à aucun compte bancaire. " +
      "Aucune donnée n'est revendue ni utilisée à des fins publicitaires.",
  },
  {
    title: '3. Finalité',
    body:
      "Vos données sont utilisées uniquement pour faire fonctionner l'application : enregistrer votre suivi financier, " +
      "le synchroniser entre vos appareils et vous permettre de le consulter. La base légale est l'exécution du service que vous demandez.",
  },
  {
    title: '4. Hébergement',
    body:
      "Vos données sont stockées de manière sécurisée chez notre sous-traitant technique Supabase, " +
      "sur une infrastructure située dans l'Union européenne. " +
      "L'accès aux données est protégé par authentification et par des règles d'isolation garantissant qu'un utilisateur ne peut accéder qu'à ses propres données.",
  },
  {
    title: '5. Durée de conservation',
    body:
      "Vos données sont conservées tant que votre compte est actif. " +
      "Lorsque vous supprimez votre compte depuis l'application, l'ensemble de vos données est supprimé.",
  },
  {
    title: '6. Vos droits',
    body:
      "Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement et de portabilité de vos données. " +
      "Vous pouvez exporter vos données à tout moment via la fonction d'export, et supprimer définitivement votre compte depuis la page Profil. " +
      `Pour exercer vos autres droits, contactez-nous à ${APP_CONTACT_EMAIL}. ` +
      "Vous pouvez également introduire une réclamation auprès de la CNIL (www.cnil.fr).",
  },
  {
    title: '7. Sécurité',
    body:
      "Nous mettons en œuvre des mesures techniques (chiffrement des échanges, authentification, isolation des données par utilisateur) " +
      "pour protéger vos informations. Aucune transmission sur Internet n'étant totalement infaillible, nous ne pouvons garantir une sécurité absolue, " +
      "mais nous nous engageons à protéger vos données avec sérieux.",
  },
]

/* ─── Modale légale réutilisable ────────────────────────────────── */
/* doc = 'cgu' | 'privacy' | null */
export function LegalModal({ doc, onClose }) {
  useEffect(() => {
    if (doc) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [doc])

  if (!doc) return null
  const isPrivacy = doc === 'privacy'
  const sections = isPrivacy ? PRIVACY_SECTIONS : CGU_SECTIONS
  const title = isPrivacy ? 'Politique de confidentialité' : "Conditions d'utilisation"

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", sans-serif',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '88vh',
          background: '#121214',
          borderTopLeftRadius: 28, borderTopRightRadius: 28,
          border: '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
          display: 'flex', flexDirection: 'column',
          animation: 'legalUp 0.4s cubic-bezier(.22,1,.36,1) both',
        }}
      >
        <style>{`@keyframes legalUp { from { transform: translateY(40px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>

        {/* Handle + header */}
        <div style={{ padding: '12px 0 0' }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.18)', margin: '0 auto' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px' }}>
          <h2 style={{ fontSize: 19, fontWeight: 700, color: '#fff', letterSpacing: '-0.4px', margin: 0 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 15, border: 'none',
              background: 'rgba(255,255,255,0.08)', color: '#fff',
              fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', padding: '4px 20px 28px', WebkitOverflowScrolling: 'touch' }}>
          <p style={{ fontSize: 11.5, color: '#6E6E73', margin: '0 0 18px', letterSpacing: '-0.1px' }}>
            Dernière mise à jour : {LAST_UPDATED}
          </p>
          {sections.map((s, i) => (
            <div key={i} style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.2px' }}>
                {s.title}
              </h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: '#A1A1AA', margin: 0, letterSpacing: '-0.1px' }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

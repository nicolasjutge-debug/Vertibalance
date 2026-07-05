// ==========================================
// CONFIGURATION JSONBIN
// ==========================================
// Remplacez uniquement la valeur BIN_ID par l'identifiant de votre conteneur
const BIN_ID = "VOTRE_BIN_ID_ICI"; 
const MASTER_KEY = "$2a$10$37WLUrV6lE8yluKasDN/nuzRMkF98j/gvrCuEj5KwNr0AuZkTPHnG"; 
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

// ==========================================
// 1. CHARGEMENT AUTOMATIQUE AU DÉMARRAGE
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    chargerDonneesDepuisJsonBin();
});

function chargerDonneesDepuisJsonBin() {
    if (BIN_ID === "VOTRE_BIN_ID_ICI") {
        console.warn("JsonBin : Pensez à configurer votre BIN_ID dans app.js");
        return;
    }
    
    console.log("Synchronisation : Récupération des données...");
    
    fetch(`${JSONBIN_URL}/latest`, {
        method: "GET",
        headers: {
            "X-Master-Key": MASTER_KEY
        }
    })
    .then(response => {
        if (!response.ok) throw new Error("Erreur lors du fetch");
        return response.json();
    })
    .then(data => {
        const donneesSynchronisees = data.record;
        console.log("Données synchronisées reçues :", donneesSynchronisees);
        
        // Appliquez ici les données à votre logique de jeu / interface VR
        // Exemple : initialiserJeu(donneesSynchronisees);
    })
    .catch(error => {
        console.error("Erreur de synchronisation au démarrage :", error);
    });
}

// ==========================================
// 2. SAUVEGARDE EN TEMPS RÉEL (Ex: depuis l'iPhone)
// ==========================================
function sauvegarderDonneesSurJsonBin(donneesAEnregistrer) {
    if (BIN_ID === "VOTRE_BIN_ID_ICI") {
        console.error("Impossible de sauvegarder : BIN_ID non configuré.");
        return;
    }

    fetch(JSONBIN_URL, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "X-Master-Key": MASTER_KEY
        },
        body: JSON.stringify(donneesAEnregistrer)
    })
    .then(response => {
        if (!response.ok) throw new Error("Erreur lors de la sauvegarde");
        return response.json();
    })
    .then(result => {
        console.log("Données sauvegardées avec succès sur JsonBin !", result);
    })
    .catch(error => {
        console.error("Erreur lors de la sauvegarde JsonBin :", error);
    });
}

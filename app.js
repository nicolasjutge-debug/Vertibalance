// ==========================================
// CONFIGURATION JSONBIN
// ==========================================
// Si localStorage contient déjà un BIN_ID, on l'utilise, sinon on prend la valeur par défaut
let BIN_ID = localStorage.getItem("VERTIBALANCE_BIN_ID") || ""; 
const MASTER_KEY = "$2a$10$37WLUrV6lE8yluKasDN/nuzRMkF98j/gvrCuEj5KwNr0AuZkTPHnG"; 
const JSONBIN_URL = "https://api.jsonbin.io/v3/b";

document.addEventListener("DOMContentLoaded", () => {
    const statusDiv = document.getElementById("sync-status");
    const createBtn = document.getElementById("btn-create-bin");

    if (BIN_ID) {
        statusDiv.innerText = `Connecté au Bin : ${BIN_ID}`;
        chargerDonneesDepuisJsonBin();
    } else {
        statusDiv.innerText = "Aucun Bin configuré. Prêt pour la génération.";
    }

    // Gestion du bouton de création de Bin automatique avec la clé Master
    if (createBtn) {
        createBtn.addEventListener("click", () => {
            creerBinAutomatiquement();
        });
    }
});

// ==========================================
// FONCTION : GÉNÉRATEUR DE BIN AUTOMATIQUE
// ==========================================
function creerBinAutomatiquement() {
    const statusDiv = document.getElementById("sync-status");
    statusDiv.innerText = "Création du conteneur distant en cours...";

    // Données initiales par défaut à stocker dans votre nouveau Bin
    const donneesInitiales = {
        score: 0,
        niveau: 1,
        dateCreation: new Date().toISOString(),
        message: "Initialisé automatiquement par VertiBalance"
    };

    fetch(JSONBIN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Master-Key": MASTER_KEY,
            "X-Bin-Private": "true",
            "X-Collection-Id": "" // Vous pouvez ajouter un ID de collection ici si besoin
        },
        body: JSON.stringify(donneesInitiales)
    })
    .then(response => {
        if (!response.ok) throw new Error("Erreur lors de la création du Bin");
        return response.json();
    })
    .then(result => {
        // Extraction du nouvel ID généré par JsonBin
        BIN_ID = result.metadata.id;
        localStorage.setItem("VERTIBALANCE_BIN_ID", BIN_ID);
        
        statusDiv.innerText = `Nouveau Bin créé et sauvegardé : ${BIN_ID}`;
        console.log("Succès ! Votre application possède maintenant son propre Bin ID :", BIN_ID);
    })
    .catch(error => {
        statusDiv.innerText = "Erreur lors de la création du Bin.";
        console.error("Détails de l'erreur :", error);
    });
}

// ==========================================
// 1. CHARGEMENT AUTOMATIQUE AU DÉMARRAGE
// ==========================================
function chargerDonneesDepuisJsonBin() {
    if (!BIN_ID) return;
    
    console.log("Synchronisation : Récupération des données...");
    
    fetch(`${JSONBIN_URL}/${BIN_ID}/latest`, {
        method: "GET",
        headers: {
            "X-Master-Key": MASTER_KEY
        }
    })
    .then(response => {
        if (!response.ok) throw new Error("Erreur réseau lors du chargement");
        return response.json();
    })
    .then(data => {
        const donneesSynchronisees = data.record;
        console.log("Données synchronisées reçues :", donneesSynchronisees);
    })
    .catch(error => {
        console.error("Erreur de chargement :", error);
    });
}

// ==========================================
// 2. SAUVEGARDE EN TEMPS RÉEL
// ==========================================
function sauvegarderDonneesSurJsonBin(donneesAEnregistrer) {
    if (!BIN_ID) {
        console.error("Impossible de sauvegarder : Aucun BIN_ID actif.");
        return;
    }

    fetch(`${JSONBIN_URL}/${BIN_ID}`, {
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
        console.log("Sauvegarde réussie sur JsonBin !", result);
    })
    .catch(error => {
        console.error("Erreur de sauvegarde :", error);
    });
}

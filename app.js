// ==========================================
// CONFIGURATION JSONBIN & NAVIGATION ABSOLUE
// ==========================================
let BIN_ID = localStorage.getItem("VERTIBALANCE_BIN_ID") || ""; 
const MASTER_KEY = "$2a$10$37WLUrV6lE8yluKasDN/nuzRMkF98j/gvrCuEj5KwNr0AuZkTPHnG"; 
const JSONBIN_URL = "https://api.jsonbin.io/v3/b";

document.addEventListener("DOMContentLoaded", () => {
    const statusDiv = document.getElementById("sync-status");
    const createBtn = document.getElementById("btn-create-bin");

    // Protection : si on est déjà sur index, ne pas lancer de génération
    if (window.location.pathname.includes("index.html") || window.location.pathname === "/") {
        console.log("Interface patient déjà active.");
        return;
    }

    if (createBtn) {
        createBtn.addEventListener("click", () => {
            creerBinAutomatiquement();
        });
    }
});

function creerBinAutomatiquement() {
    const statusDiv = document.getElementById("sync-status");
    statusDiv.innerText = "Création du BIN en cours...";

    fetch(JSONBIN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Master-Key": MASTER_KEY,
            "X-Bin-Private": "true"
        },
        body: JSON.stringify({ status: "initialisé" })
    })
    .then(r => r.json())
    .then(result => {
        BIN_ID = result.metadata.id;
        localStorage.setItem("VERTIBALANCE_BIN_ID", BIN_ID);
        
        // Phase de compte à rebours
        let count = 4;
        const interval = setInterval(() => {
            count--;
            statusDiv.innerText = `BIN ${BIN_ID} créé. Retour vers l'Interface Patient dans ${count}s...`;
            if (count <= 0) {
                clearInterval(interval);
                // Utilisation de replace pour éviter de rester dans l'historique
                window.location.replace("index.html");
            }
        }, 1000);
    })
    .catch(err => {
        statusDiv.innerText = "Erreur fatale de connexion.";
        console.error(err);
    });
}

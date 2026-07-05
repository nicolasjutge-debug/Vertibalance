// ==========================================
// CONFIGURATION JSONBIN & NAVIGATION FORCÉE
// ==========================================
let BIN_ID = localStorage.getItem("VERTIBALANCE_BIN_ID") || ""; 
const MASTER_KEY = "$2a$10$37WLUrV6lE8yluKasDN/nuzRMkF98j/gvrCuEj5KwNr0AuZkTPHnG"; 
const JSONBIN_URL = "https://api.jsonbin.io/v3/b";

document.addEventListener("DOMContentLoaded", () => {
    const statusDiv = document.getElementById("sync-status");
    const createBtn = document.getElementById("btn-create-bin");

    // Si on est sur index.html, on ne fait rien, on laisse l'app charger
    if (window.location.pathname.endsWith("index.html") || window.location.pathname === "/") {
        console.log("Interface patient chargée.");
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
    statusDiv.innerText = "Création en cours...";

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
        
        let count = 3;
        statusDiv.innerText = `Bin créé. Retour à l'accueil dans ${count}s...`;
        
        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                statusDiv.innerText = `Bin créé. Retour à l'accueil dans ${count}s...`;
            } else {
                clearInterval(interval);
                // Forcer le retour absolu à la racine du site
                window.location.replace("index.html");
            }
        }, 1000);
    })
    .catch(err => {
        statusDiv.innerText = "Erreur de création.";
        console.error(err);
    });
}

// ==========================================
// CONFIGURATION JSONBIN & NAVIGATION
// ==========================================
let BIN_ID = localStorage.getItem("VERTIBALANCE_BIN_ID") || ""; 
const MASTER_KEY = "$2a$10$37WLUrV6lE8yluKasDN/nuzRMkF98j/gvrCuEj5KwNr0AuZkTPHnG"; 
const JSONBIN_URL = "https://api.jsonbin.io/v3/b";

document.addEventListener("DOMContentLoaded", () => {
    const statusDiv = document.getElementById("sync-status");
    const createBtn = document.getElementById("btn-create-bin");

    if (BIN_ID) {
        statusDiv.innerText = `Connecté au Bin : ${BIN_ID}`;
        // Redirection immédiate si déjà connecté
        setTimeout(() => { window.location.href = "index.html"; }, 1000);
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
        statusDiv.innerText = `Bin créé : ${BIN_ID}. Retour à l'interface dans ${count}s...`;
        
        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                statusDiv.innerText = `Bin créé : ${BIN_ID}. Retour à l'interface dans ${count}s...`;
            } else {
                clearInterval(interval);
                window.location.href = "index.html"; // Retour forcé
            }
        }, 1000);
    })
    .catch(err => {
        statusDiv.innerText = "Erreur de création. Réessayez.";
        console.error(err);
    });
}

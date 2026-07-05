// ==========================================
// CONFIGURATION JSONBIN & REDIRECTION
// ==========================================
let BIN_ID = localStorage.getItem("VERTIBALANCE_BIN_ID") || ""; 
const MASTER_KEY = "$2a$10$37WLUrV6lE8yluKasDN/nuzRMkF98j/gvrCuEj5KwNr0AuZkTPHnG"; 
const JSONBIN_URL = "https://api.jsonbin.io/v3/b";

document.addEventListener("DOMContentLoaded", () => {
    const statusDiv = document.getElementById("sync-status");
    const createBtn = document.getElementById("btn-create-bin");

    if (BIN_ID) {
        statusDiv.innerText = `Connecté au Bin : ${BIN_ID}`;
        // Redirection automatique rapide vers index.html après chargement
        setTimeout(() => { window.location.href = "index.html"; }, 1500);
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
        statusDiv.innerText = `Bin créé : ${BIN_ID}. Redirection vers l'accueil...`;
        
        // Redirection automatique vers index.html après 3 secondes
        setTimeout(() => {
            window.location.href = "index.html";
        }, 3000);
    });
}
